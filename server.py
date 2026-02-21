from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import base64
import json
import requests
import io
import fitz  # PyMuPDF: Dùng để xử lý PDF
import os
from PIL import Image
from dotenv import load_dotenv

# Initialize FastAPI
app = FastAPI()

load_dotenv()

# CORS Configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- CONFIGURATION ---
API_KEY = os.getenv("API_KEY")
if not API_KEY:
    print("WARNING: API_KEY not found in environment variables.")

# Define endpoints for different models
GEMINI_URL_FLASH = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key={API_KEY}"
GEMINI_URL_PRO = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key={API_KEY}"

# --- PROMPTS ---

# 1. STANDARD PROMPT (Hóa đơn / Phiếu kho - Dùng Flash Lite)
STANDARD_PROMPT = """
You are an expert OCR engine. Analyze the image and extract data into JSON.

### 1. EXTRACTION RULES
- **doc_type**: "Invoice", "Import", or "Export".
- **date**: DD/MM/YYYY format.
- **id**: Document Number (Số phiếu).
- **name**: Deliverer/Supplier Name.
- **code**: Product Code (Mã số).
- **unit**: Unit (e.g., Cái, Kg, Chiếc, Lít, m3).
- **unitprice**: Number.
- **totalprice**: Number.

### 2. QUANTITY COLUMNS (STRICT MAPPING)
Vietnamese warehouse forms (Phiếu Xuất/Nhập Kho) typically have two quantity columns side-by-side:
| Yêu cầu (1) | Thực Nhập/Xuất (2) |

- **quantity_doc**: Number or null. This corresponds to column (1) "Yêu cầu". If this visual column is blank, return `null`.
- **quantity_actual**: Number or null. This corresponds to column (2) "Thực nhập" or "Thực xuất". If this visual column is blank, return `null`.

**CRITICAL RULE:** - If the "Yêu cầu" column is empty, and "Thực Xuất" has a number (e.g. 5), you MUST return: `{"quantity_doc": null, "quantity_actual": 5}`.
- DO NOT put the actual quantity into `quantity_doc`.

### 3. SMART DESCRIPTION & ORDER NUMBER PARSING
You must separate the Item Description from the Serial/Order Numbers.

**Field: `description`**
- Keep the technical specifications (e.g., "MBA 320KVA - 22/0,4KV").
- REMOVE the serial numbers/ranges from this string.

**Field: `order_numbers` (Array of Strings)**
- Extract the specific codes/serials found in the description line.
- **Prefix Logic:** If a list is "25B827, 828, 621", apply the prefix "25B" to all numbers -> ["25B827", "25B828", "25B621"].
- **Range Logic:** If a range is "25B834-->838" or "25B834-838", expand it -> ["25B834", "25B835", "25B836", "25B837", "25B838"].

### 4. EXAMPLE SCENARIOS
**Input Image:** Table row shows Column "Yêu cầu" is empty. Column "Thực Xuất" is 10. Description contains codes 25B834 to 25B838 and 25B840 to 25B844.
**Output:**
{
  "description": "MBA 560KVA - 22/0,4KV",
  "order_numbers": ["25B834", "25B835", "25B836", "25B837", "25B838", "25B840", "25B841", "25B842", "25B843", "25B844"],
  "quantity_doc": null,
  "quantity_actual": 10
}

### OUTPUT FORMAT:
Return ONLY a raw JSON Array. Do not include markdown blocks like ```json.
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

# 2. MATERIAL LIST PROMPT (Bảng kê vật tư - Dùng Pro)
MATERIAL_LIST_PROMPT = """
You are a data conversion engine. Convert this Bill of Materials PDF into a clean CSV.
        
        CRITICAL DATA EXTRACTION RULES:
        1.  **Columns:** STT | Tên vật tư | Quy cách | ĐVT | Định mức | Thực lĩnh | Chênh lệch | Ghi chú
        
        2.  **Fix "STT" (Sequence):** Capture "A", "B", "C" for headers and "1", "2", "3" for items.
            - **CRITICAL:** Preserve rows that have an STT number but are otherwise empty. 
            - Example: If the PDF shows a row number "20" with no other text, output: `20|||||||`
            
        3.  **Fix "Định mức" (Rated) & "Thực lĩnh" (Actual) - STRICT RULE:** - In the PDF, usually two numbers are stacked in the quantity area.
            - **Case A (Two Numbers Found):** The FIRST/TOP number is "Định mức". The SECOND/BOTTOM number is "Thực lĩnh". (They may be different values).
            - **Case B (One Number Found):** If only one number is visible, it is "Định mức". Leave "Thực lĩnh" EMPTY.
            - **Case C (Empty):** If no numbers are found, leave both empty.
            - **Math Addition:** If workers wrote an addition formula like "1+1" or "2 + 1" (e.g., Định mức is 1, Thực lĩnh is 1+1), calculate the total and output ONLY the final sum (e.g., "2").
            
            - **Cleanup:** Convert all commas to dots (e.g., "20,5" -> "20.5"). Remove symbols like "v", "V", or "/" attached to numbers (e.g., "1v" -> "1").
        
        4.  **Fix "Quy cách" (Specification):** Combine stacked text into one line (e.g., "45 0.27").
        
        5.  **Output Format:** - Pipe separated (|). 
            - No markdown. 
            - First line MUST be the header.

        6.  **Handwriting Quirks (BE CAREFUL):**
            - Workers have messy handwriting. Pay close attention to stroke patterns.
            - "1" is often written with a heavy top hook, making it look like "4" or "7".
            - **Row Line Interference (CRITICAL):** If a "1" is written too low, the printed horizontal line separating the rows might cross through it. This visual overlap makes the "1" look exactly like a "4". If the horizontal bar of a suspected "4" perfectly aligns with the table's row border, it is actually a "1".
            - "6" is sometimes closed tightly, making it look like "0".
            - **Logical check:** "Thực lĩnh" is usually equal to or very close to "Định mức". If "Định mức" is 10, and the handwritten "Thực lĩnh" looks like "40" or "70", it is almost certainly "10". Use common sense based on the row context.

        Example Output:
        STT|Tên vật tư|Quy cách|ĐVT|Định mức|Thực lĩnh|Chênh lệch|Ghi chú
        A|TÔN SILIC||||||
        1|Tôn TU|45 x 0.27|Kg|20.5|20.5||
        2|Tôn TI|45 0.27|Kg|5.1|5.4||
        3|Dây Teflon|2.5mm2|m|10|14||
        4|Dây Khác|Type C|m|5|||
        5|||||||
        6|||||||
        7|Vật tư cộng thêm|Loại 1|cái|1|2||
"""

def pdf_to_images(file_bytes):
    """Chuyển PDF thành hình ảnh (Chỉ dùng cho Standard Mode)"""
    images = []
    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        if doc.page_count > 0:
            for page in doc:
                pix = page.get_pixmap(dpi=300) 
                images.append(pix.tobytes("jpeg"))
            return images
        else:
            raise Exception("PDF has no pages.")
    except Exception as e:
        print(f"PDF Conversion Error: {e}")
        raise

def parse_material_csv(raw_text):
    """Hàm thay thế Pandas để parse kết quả từ Gemini Pro CSV sang dạng Array Object JSON"""
    clean_text = raw_text.replace("```csv", "").replace("```", "").strip()
    clean_lines = []
    for line in clean_text.split('\n'):
        line = line.strip()
        if line.count('|') >= 7 and "---" not in line:
            clean_lines.append(line)
            
    if not clean_lines:
        return []

    headers = [h.strip() for h in clean_lines[0].split('|')]
    
    def evaluate_math(val_str):
        val_str = str(val_str).strip().replace('v', '').replace('V', '').replace('✓', '').replace('/', '')
        if '+' in val_str:
            try:
                total = sum(float(i.strip()) for i in val_str.split('+') if i.strip())
                return int(total) if total.is_integer() else total
            except Exception:
                return val_str
        return val_str

    data = []
    for line in clean_lines[1:]:
        parts = [p.strip() for p in line.split('|')]
        # Pad parts just in case
        while len(parts) < len(headers):
            parts.append("")
        
        row_dict = dict(zip(headers, parts[:len(headers)]))
        
        # Cleanup math
        for col in ['Định mức', 'Thực lĩnh']:
            if col in row_dict:
                row_dict[col] = evaluate_math(row_dict[col])
                
        data.append(row_dict)
        
    return data

def flatten_data(data):
    """Hàm xử lý tách dòng (Post-processing) dành cho Hóa đơn/Chứng từ"""
    flattened = []
    for item in data:
        order_nums = item.get('order_numbers', [])
        
        if isinstance(order_nums, list) and len(order_nums) > 0:
            def get_val(key):
                v = item.get(key)
                try: 
                    return float(v) if v is not None else None
                except: 
                    return None
            
            val_actual = get_val('quantity_actual')
            val_doc = get_val('quantity_doc')
            target_qty = val_actual if val_actual is not None else val_doc
            
            count_codes = len(order_nums)
            is_count_match = (target_qty == count_codes) if target_qty is not None else False
            
            for code in order_nums:
                new_item = item.copy()
                new_item['order_numbers'] = str(code) 
                
                if is_count_match:
                    if val_actual is not None: new_item['quantity_actual'] = 1
                    if val_doc is not None: new_item['quantity_doc'] = 1
                    if new_item.get('unitprice'): new_item['totalprice'] = new_item.get('unitprice')
                
                flattened.append(new_item)
        else:
            if isinstance(order_nums, list):
                item['order_numbers'] = ", ".join(map(str, order_nums))
            flattened.append(item)
            
    return flattened

@app.get("/")
def read_root():
    return {"status": "Online", "message": "Server is running."}

@app.post("/extract")
async def extract_document(
    file: UploadFile = File(...), 
    mode: str = Form("standard")
):
    print(f"\n--> Receiving file: {file.filename} | Mode: {mode}")
    
    try:
        file_bytes = await file.read()
        is_material_mode = (mode == "material_list")
        
        # --- CONFIG ROUTING ---
        system_prompt = MATERIAL_LIST_PROMPT if is_material_mode else STANDARD_PROMPT
        target_url = GEMINI_URL_PRO if is_material_mode else GEMINI_URL_FLASH
        target_model_name = "gemini-2.5-pro" if is_material_mode else "gemini-2.5-flash-lite"
        
        image_parts = []

        # --- PREPARE PAYLOAD ---
        if is_material_mode and file.filename.lower().endswith(".pdf"):
            # PRO MODE: Pass Raw PDF Bytes directly for reasoning
            print(f"   Using {target_model_name} with direct PDF upload.")
            encoded_pdf = base64.b64encode(file_bytes).decode("utf-8")
            image_parts.append({
                "inline_data": {
                    "mime_type": "application/pdf",
                    "data": encoded_pdf
                }
            })
        elif file.filename.lower().endswith(".pdf"):
            # STANDARD MODE: Convert to Images
            print(f"   Converting PDF to images for {target_model_name}...")
            images_bytes_list = pdf_to_images(file_bytes)
            
            for img_bytes in images_bytes_list:
                try:
                    image = Image.open(io.BytesIO(img_bytes))
                    MAX_SIZE = 3072 
                    if max(image.size) > MAX_SIZE:
                        image.thumbnail((MAX_SIZE, MAX_SIZE))
                    
                    buffered = io.BytesIO()
                    if image.mode in ("RGBA", "P"): image = image.convert("RGB")
                    image.save(buffered, format="JPEG", quality=85)
                    
                    encoded_image = base64.b64encode(buffered.getvalue()).decode("utf-8")
                    image_parts.append({
                        "inline_data": {
                            "mime_type": "image/jpeg",
                            "data": encoded_image
                        }
                    })
                except Exception as img_err:
                    pass
        else:
            # NORMAL IMAGE HANDLING
            try:
                image = Image.open(io.BytesIO(file_bytes))
                MAX_SIZE = 3072 
                if max(image.size) > MAX_SIZE:
                    image.thumbnail((MAX_SIZE, MAX_SIZE))
                    
                buffered = io.BytesIO()
                if image.mode in ("RGBA", "P"): image = image.convert("RGB")
                image.save(buffered, format="JPEG", quality=85)
                encoded_image = base64.b64encode(buffered.getvalue()).decode("utf-8")
                image_parts.append({
                    "inline_data": {
                        "mime_type": "image/jpeg",
                        "data": encoded_image
                    }
                })
            except Exception as e:
                # Fallback to direct bytes
                encoded_image = base64.b64encode(file_bytes).decode("utf-8")
                mime = "image/png" if file.filename.lower().endswith(".png") else "image/jpeg"
                image_parts.append({"inline_data": {"mime_type": mime, "data": encoded_image}})

        # --- CALL GOOGLE API ---
        payload = {
            "contents": [{
                "parts": [{"text": system_prompt}] + image_parts
            }],
            "generationConfig": {
                "temperature": 0.1,
                # JSON Format only required for Standard Mode. Material uses raw text parser.
                "response_mime_type": "text/plain" if is_material_mode else "application/json"
            }
        }

        print(f"--> Calling {target_model_name}...")
        response = requests.post(target_url, json=payload)

        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=f"Gemini API Error: {response.text}")

        result_json = response.json()
        
        try:
            raw_response = result_json["candidates"][0]["content"]["parts"][0]["text"]
        except (KeyError, IndexError):
             raise HTTPException(status_code=500, detail="Gemini returned unexpected structure.")

        print(f"--> Response received ({len(raw_response)} chars).")
        
        # --- PROCESS RESULT ---
        if is_material_mode:
            # Parse CSV Logic
            processed_data = parse_material_csv(raw_response)
            return {"data": processed_data}
        else:
            # Parse JSON Logic (Standard)
            clean_text = raw_response.replace("```json", "").replace("```", "").strip()
            try:
                extracted_data = json.loads(clean_text)
                if isinstance(extracted_data, dict):
                    extracted_data = [extracted_data]
                processed_data = flatten_data(extracted_data)
                return {"data": processed_data}
            except json.JSONDecodeError:
                return {"data": [], "error": "Failed to parse JSON.", "raw_text": raw_response}

    except Exception as e:
        print(f"Server Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    print(f"Starting Gemini Proxy Server on port 8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)