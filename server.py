from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import base64
import json
import requests
import re
from PIL import Image
import io
import fitz  # PyMuPDF: Dùng để xử lý PDF
import os
# Initialize FastAPI
app = FastAPI()

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- CONFIGURATION ---
# API Key của bạn (Lấy từ lịch sử chat)
API_KEY = os.getenv("API_KEY")
if not API_KEY:
    raise RuntimeError("API_KEY is not set")
MODEL_NAME = "gemini-2.5-flash-lite"
GEMINI_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL_NAME}:generateContent?key={API_KEY}"

# PROMPT (Giữ nguyên theo yêu cầu)
SYSTEM_PROMPT = """
You are an expert OCR engine. Analyze the image and extract data into JSON.

### 1. EXTRACTION RULES
- **doc_type**: "Invoice", "Import", or "Export".
- **date**: DD/MM/YYYY format.
- **id**: Document Number (Số phiếu).
- **name**: Deliverer/Supplier Name.
- **unit**: Unit (e.g., Cái, Kg).
- **quantity**: Number.
- **unitprice**: Number.
- **totalprice**: Number.

### 2. SMART DESCRIPTION & ORDER NUMBER PARSING (CRITICAL)
You must separate the Item Description from the Serial/Order Numbers.

**Field: `description`**
- Keep the technical specifications (e.g., "MBA 320KVA - 22/0,4KV").
- REMOVE the serial numbers/ranges from this string.

**Field: `order_numbers` (Array of Strings)**
- Extract the specific codes/serials found in the description line.
- **Prefix Logic:** If a list is "25B827, 828, 621", apply the prefix "25B" to all numbers -> ["25B827", "25B828", "25B621"].
- **Range Logic:** If a range is "25B834-->838" or "25B834-838", expand it -> ["25B834", "25B835", "25B836", "25B837", "25B838"].

### 3. EXAMPLE SCENARIOS
**Input Text:** "MBA 560KVA-22/0,4KV 25B834-->836"
**Output:**
{
  "description": "MBA 560KVA-22/0,4KV",
  "order_numbers": ["25B834", "25B835", "25B836"]
}

**Input Text:** "MBA 320KVA - 22/0,4KV 25B827, 828"
**Output:**
{
  "description": "MBA 320KVA - 22/0,4KV",
  "order_numbers": ["25B827", "25B828"]
}

### OUTPUT FORMAT:
Return ONLY a raw JSON Array. Do not include markdown blocks like ```json.
Example:
[
  {
    "doc_type": "Import",
    "date": "14/07/2022",
    "id": "NK00123",
    "name": "Supplier Name",
    "description": "Item Name",
    "order_numbers": ["Code1", "Code2"],
    "code": "Code",
    "unit": "Unit",
    "quantity": 10,
    "unitprice": 500000,
    "totalprice": 5000000
  }
]
"""

def pdf_to_image_bytes(file_bytes):
    """Chuyển trang đầu tiên của PDF thành bytes ảnh PNG"""
    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        if doc.page_count > 0:
            page = doc.load_page(0) # Lấy trang đầu tiên
            pix = page.get_pixmap(dpi=200) # DPI 200 là đủ nét
            return pix.tobytes("png")
        else:
            raise Exception("PDF has no pages.")
    except Exception as e:
        print(f"PDF Conversion Error: {e}")
        raise

def flatten_data(data):
    """
    Hàm xử lý tách dòng (Post-processing):
    Nếu một dòng có nhiều mã đơn hàng (order_numbers), tách thành nhiều dòng.
    """
    flattened = []
    for item in data:
        order_nums = item.get('order_numbers', [])
        
        # Nếu order_numbers là mảng và có dữ liệu
        if isinstance(order_nums, list) and len(order_nums) > 0:
            # Logic thông minh: Kiểm tra xem số lượng mã có khớp với số lượng hàng (Quantity) không
            original_qty = 0
            try:
                original_qty = float(item.get('quantity', 0))
            except:
                pass
            
            is_count_match = (original_qty == len(order_nums))
            
            # Tạo dòng mới cho từng mã
            for code in order_nums:
                new_item = item.copy()
                new_item['order_numbers'] = str(code) # Chuyển thành chuỗi để hiển thị
                
                # Nếu khớp số lượng (VD: 3 mã, SL=3) -> Mỗi dòng là 1 cái, Thành tiền = Đơn giá
                if is_count_match:
                    new_item['quantity'] = 1
                    if 'unitprice' in new_item:
                        new_item['totalprice'] = new_item['unitprice']
                
                flattened.append(new_item)
        else:
            # Nếu không có mã hoặc định dạng sai, giữ nguyên
            if isinstance(order_nums, list):
                item['order_numbers'] = ", ".join(map(str, order_nums))
            flattened.append(item)
            
    return flattened

@app.get("/")
def read_root():
    return {"status": "Online", "message": f"Server running with Google {MODEL_NAME}"}

@app.post("/extract")
async def extract_document(file: UploadFile = File(...)):
    print(f"\n--> Receiving file: {file.filename}")
    
    try:
        file_bytes = await file.read()
        
        # --- XỬ LÝ FILE: PDF hoặc ẢNH ---
        final_image_bytes = None
        mime_type = "image/jpeg" # Mặc định
        
        # 1. Nếu là PDF -> Convert sang Ảnh
        if file.filename.lower().endswith(".pdf"):
            print("   Detected PDF. Converting first page to image...")
            final_image_bytes = pdf_to_image_bytes(file_bytes)
            mime_type = "image/png"
        else:
            # 2. Nếu là Ảnh
            final_image_bytes = file_bytes
            if file.filename.lower().endswith(".png"):
                mime_type = "image/png"

        # --- TỐI ƯU HÓA ẢNH ---
        # Gemini xử lý được ảnh lớn nên ta có thể để max size cao hơn (2048px)
        try:
            image = Image.open(io.BytesIO(final_image_bytes))
            MAX_SIZE = 2048 
            if max(image.size) > MAX_SIZE:
                print(f"   Resize: Original size {image.size} -> Scaling to max {MAX_SIZE}px...")
                image.thumbnail((MAX_SIZE, MAX_SIZE))
                
                buffered = io.BytesIO()
                if image.mode in ("RGBA", "P"): 
                    image = image.convert("RGB")
                
                image.save(buffered, format="JPEG", quality=85)
                final_image_bytes = buffered.getvalue()
                mime_type = "image/jpeg"
        except Exception as img_err:
            print(f"   Image Processing Warning: {img_err}. Using original bytes.")
            pass
        
        # Encode to Base64
        encoded_image = base64.b64encode(final_image_bytes).decode("utf-8")

        # 3. Chuẩn bị dữ liệu gửi Google Gemini API
        payload = {
            "contents": [{
                "parts": [
                    { "text": SYSTEM_PROMPT },
                    {
                        "inline_data": {
                            "mime_type": mime_type,
                            "data": encoded_image
                        }
                    }
                ]
            }],
            "generationConfig": {
                "temperature": 0.1,
                "response_mime_type": "application/json"
            }
        }

        print(f"--> Sending image to Google Gemini ({MODEL_NAME})...")
        response = requests.post(GEMINI_URL, json=payload)

        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=f"Gemini API Error: {response.text}")

        # 4. Xử lý kết quả
        result_json = response.json()
        
        try:
            raw_response = result_json["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError):
             print("DUMP:", json.dumps(result_json, indent=2))
             raise HTTPException(status_code=500, detail="Gemini returned unexpected structure.")

        print(f"--> Response received ({len(raw_response)} chars).")

        # 5. Làm sạch JSON
        clean_text = raw_response.replace("```json", "").replace("```", "").strip()
        
        try:
            extracted_data = json.loads(clean_text)
            if isinstance(extracted_data, dict):
                extracted_data = [extracted_data]
            
            # --- ÁP DỤNG LOGIC TÁCH DÒNG ---
            processed_data = flatten_data(extracted_data)
            
            return {"data": processed_data}
        except json.JSONDecodeError:
            print("JSON Parsing Failed. Raw AI Response:\n", raw_response)
            return {
                "data": [],
                "error": "Failed to parse JSON.",
                "raw_text": raw_response
            }

    except Exception as e:
        print(f"Server Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    print(f"Starting Gemini Proxy Server on http://localhost:8000 using {MODEL_NAME}")
    uvicorn.run(app, host="0.0.0.0", port=8000)