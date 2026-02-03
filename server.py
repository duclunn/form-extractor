from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import base64
import json
import requests
import re
from PIL import Image
import io

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
OLLAMA_BASE_URL = "http://localhost:11434"
OLLAMA_CHAT_URL = f"{OLLAMA_BASE_URL}/api/chat"
OLLAMA_TAGS_URL = f"{OLLAMA_BASE_URL}/api/tags"

# Tên model bạn muốn dùng. 
# Hãy mở terminal gõ 'ollama list' để xem tên chính xác.
# Ví dụ: 'qwen2.5-vl:latest', 'llama3.2-vision', 'minicpm-v'
MODEL_NAME = "qwen3-vl:8b" 

# PROMPT
SYSTEM_PROMPT = """
You are an expert OCR engine. Analyze the image and extract data into JSON.

### EXTRACTION RULES:
- **doc_type**: "Invoice", "Import", or "Export".
- **date**: DD/MM/YYYY format.
- **id**: Document Number (Số phiếu).
- **name**: Deliverer/Supplier Name.
- **description**: Item Name.
- **unit**: Unit (e.g., Cái, Kg).
- **quantity**: Number.
- **unitprice**: Number.
- **totalprice**: Number.

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
    "code": "Code",
    "unit": "Unit",
    "quantity": 10,
    "unitprice": 500000,
    "totalprice": 5000000
  }
]
"""

def check_model_exists():
    try:
        response = requests.get(OLLAMA_TAGS_URL)
        if response.status_code == 200:
            models = response.json().get('models', [])
            available_names = [m['name'] for m in models]
            print(f"--> Available Ollama models: {available_names}")
            
            # Check exact match or partial match
            if not any(MODEL_NAME in name for name in available_names):
                print(f"\n⚠️ WARNING: Model '{MODEL_NAME}' not found in Ollama library!")
                print(f"👉 Please run: ollama pull {MODEL_NAME}")
                return False
            return True
    except Exception as e:
        print(f"⚠️ Could not connect to Ollama: {e}")
        return False
    return True

@app.get("/")
def read_root():
    return {"status": "Online", "message": f"Pure Vision Server running with model: {MODEL_NAME}"}

@app.post("/extract")
async def extract_document(file: UploadFile = File(...)):
    print(f"\n--> Receiving file: {file.filename}")
    
    try:
        # 1. Read Image File
        file_bytes = await file.read()
        
        # --- OPTIMIZATION: RESIZE IMAGE ---
        # Reduce image resolution to speed up LLM processing significantly
        try:
            image = Image.open(io.BytesIO(file_bytes))
            
            # Max dimension 1024px is usually enough for invoices but much faster
            MAX_SIZE = 1024 
            if max(image.size) > MAX_SIZE:
                print(f"   Resize: Original size {image.size} -> Scaling to max {MAX_SIZE}px...")
                image.thumbnail((MAX_SIZE, MAX_SIZE))
            
            # Convert back to base64
            buffered = io.BytesIO()
            # Convert to RGB to handle potential alpha channels/CMYK issues
            if image.mode in ("RGBA", "P"): 
                image = image.convert("RGB")
            
            image.save(buffered, format="JPEG", quality=85)
            encoded_image = base64.b64encode(buffered.getvalue()).decode("utf-8")
        except Exception as img_err:
            print(f"   Image Processing Warning: {img_err}. Using original bytes.")
            encoded_image = base64.b64encode(file_bytes).decode("utf-8")
        # ----------------------------------

        # 2. Prepare Payload for Chat API
        payload = {
            "model": MODEL_NAME,
            "messages": [
                {
                    "role": "user",
                    "content": SYSTEM_PROMPT,
                    "images": [encoded_image]
                }
            ],
            "stream": False,
            # REMOVED format: "json" to prevent empty responses on some models
            "options": {
                "temperature": 0.0, 
                "num_ctx": 4096     
            }
        }

        print(f"--> Sending image to Ollama ({MODEL_NAME})...")
        response = requests.post(OLLAMA_CHAT_URL, json=payload)

        if response.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Ollama Error: {response.text}")

        # 3. Parse Response
        result_json = response.json()
        raw_response = result_json.get("message", {}).get("content", "")
        print(f"--> Response received ({len(raw_response)} chars).")

        if not raw_response:
             print("DUMP:", json.dumps(result_json, indent=2))
             raise HTTPException(status_code=500, detail="Ollama returned empty response.")

        # 4. Clean JSON (Remove markdown code blocks if present)
        # Regex to find JSON array [ ... ]
        json_match = re.search(r'\[.*\]', raw_response, re.DOTALL)
        
        if json_match:
            clean_text = json_match.group(0)
        else:
            # Fallback cleanup
            clean_text = raw_response.replace("```json", "").replace("```", "").strip()
        
        try:
            extracted_data = json.loads(clean_text)
            if isinstance(extracted_data, dict):
                extracted_data = [extracted_data]
            return {"data": extracted_data}
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
    check_model_exists()
    print(f"Starting Pure Vision Server on http://localhost:8000 using {MODEL_NAME}")
    uvicorn.run(app, host="0.0.0.0", port=8000)