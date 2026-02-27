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
GEMINI_URL_FLASH = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={API_KEY}"
GEMINI_URL_PRO = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key={API_KEY}"

# --- PROMPTS ---

# 1. STANDARD PROMPT (Hóa đơn / Phiếu kho - Dùng Flash Lite)
STANDARD_PROMPT = """
You are an expert OCR engine. Analyze the image and extract data into JSON.

### 1. EXTRACTION RULES
- **doc_type**: "Invoice", "Import", or "Export".
- **date**: DD/MM/YYYY format. Look for the text like "Ngày ... tháng ... năm ..." located centrally, directly UNDER the document title (doc_type) and ABOVE the document number (id). Example: "Ngày 01 tháng 12 năm 2025" -> "01/12/2025". STRICTLY IGNORE any printed dates on the top right corner (e.g., "ngày 26/08/2016" or "22/12/2014").
- **id**: Document Number (Số phiếu).
- **name**: Deliverer/Supplier Name.
- **code**: Product Code (Mã số).
- **unit**: Unit (e.g., Cái, Kg, Chiếc, Lít, m3).
- **unitprice**: Number.
- **totalprice**: Number.

**CRITICAL RULES FOR ROWS TO IGNORE:**
- You MUST completely ignore the table sub-header row that contains column index symbols like "A", "B", "C", "D", "1", "2", "3", "4" in its cells. This is NOT an actual product/item. DO NOT extract this row into the JSON output. 
- CRITICAL: DO NOT mistakenly read the index numbers "1" or "2" from this sub-header row as your `quantity_doc` or `quantity_actual` values!

### 2. QUANTITY COLUMNS (STRICT MAPPING & ANTI-SHIFTING)
Vietnamese warehouse forms (Phiếu Xuất/Nhập Kho) typically have two quantity columns side-by-side under the main "Số lượng" (Quantity) header:
- Column 1: "Yêu cầu" or "Theo chứng từ". Maps to -> `quantity_doc`
- Column 2: "Thực xuất" or "Thực nhập". Maps to -> `quantity_actual`

**CRITICAL RULES FOR QUANTITY (PREVENT LAYOUT SHIFT):**
1. NEVER auto-fill, shift, or copy values between columns. 
2. BEWARE OF RIGHT-ALIGNED NUMBERS: Numbers in Column 1 ("Theo chứng từ") are often right-aligned, putting them visually very close to Column 2 ("Thực nhập"). You MUST keep them in `quantity_doc`. Do NOT shift them to `quantity_actual`.
3. NEVER use the column index "1" from the sub-header row (A, B, C, D, 1, 2, 3, 4) as a quantity value.
4. If Column 1 has a number (e.g., 6) and Column 2 is visually blank, you MUST return: `{"quantity_doc": 6, "quantity_actual": null}`. 
5. Numbers with spaces (e.g., "3 193" or "5 670") must be extracted as single values ("3193", "5670").

### 3. SMART DESCRIPTION & ORDER NUMBER PARSING
You must separate the Item Description from the Serial/Order Numbers.

**Field: `description`**
- Extract the FULL item description exactly as written, including all technical specifications, model codes, fractions, and brands (e.g., "Điều chỉnh dưới tải CVIII-350Y/40.5-14271W", "Sứ cao thế mới 35/250- CD 965 Đông Hải").
- DO NOT trim, cut off, or remove any part of the product name or specifications. 
- ONLY remove distinct Serial/Order Numbers (e.g., lists of IDs like "25B834, 25B835", "22A023") IF they clearly represent individual instance serials appended at the very end of the text.

**Field: `order_numbers` (Array of Strings)**
- Extract the specific codes/serials ONLY IF they are physically written directly inside the item's description cell INSIDE THE TABLE.
- CRITICAL: DO NOT extract codes/serials from the general document "Nội dung" (Content/Reason) section at the top of the page (e.g., "Nhập lại VT tháo ra từ máy MOF 80-40/5A 21C783"). If the table row itself does not contain a code, you MUST return an empty array `[]`.
- **STRICT PREFIX LOGIC (CRITICAL):** You MUST apply the leading prefix (like "25B", "22A", "25C", etc.) to ALL subsequent numbers in a comma-separated list. 
  - Example: If the text says "25B827, 828, 621", you MUST output: ["25B827", "25B828", "25B621"]. 
  - DO NOT output ["25B827", "828", "621"].
- **STRICT RANGE LOGIC (CRITICAL):** If you see a range with a hyphen/dash or arrow (e.g., "25B834-838", "25B834 - 838", or "25B834-->838"), you MUST calculate and list EVERY intermediate number in the array.
  - Correct Output for "25B834-838": ["25B834", "25B835", "25B836", "25B837", "25B838"]
  - INCORRECT Output: ["25B834", "838"] or ["25B834", "25B838"] (You must NOT skip the numbers in between!)
  - INCORRECT Output: ["25B834-838"] (You must expand it into separate items)
  - You must explicitly count and generate the full mathematical sequence.

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
    "quantity_doc": null,
    "quantity_actual": 10,
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
            - **Math Operations:** If workers wrote an addition formula like "1+1" or "2 + 1", or a multiplication formula like "4.5x4" or "9 x 5", calculate the total/product and output ONLY the final result (e.g., "2", "18", "45").
            
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
        # BỘ LỌC AN TOÀN KÉP: Loại bỏ nếu AI vô tình bắt dính hàng chỉ mục "A", "B", "C", "D" hoặc hàng Header
        desc = str(item.get('description', '')).strip().upper()
        if (desc in ['B', 'C', 'D'] or 
            'NHÃN HIỆU QUY CÁCH' in desc or 
            'PHẨM CHẤT VẬT TƯ' in desc or 
            'SẢN PHẨM, HÀNG' in desc or 
            'TÊN VẬT TƯ' in desc or
            'TÊN, NHÃN HIỆU' in desc):
            continue  # Bỏ qua dòng này hoàn toàn

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

        # --- CALL GOOGLE API & PROCESS RESULT ---
        if is_material_mode:
            # MATERIAL LIST (PRO MODEL) - One big call
            payload = {
                "contents": [{
                    "parts": [{"text": system_prompt}] + image_parts
                }],
                "generationConfig": {
                    "temperature": 0.1,
                    "response_mime_type": "text/plain"
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
            processed_data = parse_material_csv(raw_response)
            return {"data": processed_data}

        else:
            # STANDARD MODE (FLASH LITE) - Process page by page
            print(f"--> Calling {target_model_name} sequentially for {len(image_parts)} pages...")
            all_extracted_data = []
            error_logs = []

            for i, img_part in enumerate(image_parts):
                print(f"    Processing page {i+1}/{len(image_parts)}...")
                payload = {
                    "contents": [{
                        "parts": [{"text": system_prompt}, img_part]
                    }],
                    "generationConfig": {
                        "temperature": 0.1,
                        "response_mime_type": "application/json"
                    }
                }

                response = requests.post(target_url, json=payload)
                if response.status_code != 200:
                    print(f"    Page {i+1} API Error: {response.text}")
                    error_logs.append(f"Page {i+1} failed.")
                    continue

                result_json = response.json()
                try:
                    raw_response = result_json["candidates"][0]["content"]["parts"][0]["text"]
                    clean_text = raw_response.replace("```json", "").replace("```", "").strip()
                    page_data = json.loads(clean_text)
                    
                    # Ensure it's a list
                    if isinstance(page_data, dict):
                        page_data = [page_data]
                        
                    all_extracted_data.extend(page_data)
                except Exception as e:
                    print(f"    Page {i+1} JSON Parse Error: {str(e)}")
                    error_logs.append(f"Page {i+1} parsing failed.")

            if not all_extracted_data and error_logs:
                return {"data": [], "error": "Failed to extract data: " + ", ".join(error_logs)}

            # Apply flattening logic to the combined results
            processed_data = flatten_data(all_extracted_data)
            return {"data": processed_data}

    except Exception as e:
        print(f"Server Error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    print(f"Starting Gemini Proxy Server on port 8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)