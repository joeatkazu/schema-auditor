import os
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from playwright.async_api import async_playwright
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = FastAPI()

# 1. CORS Setup
app.add_middleware(
    CORSMiddleware,
    # ALLOW ALL ORIGINS (Easiest for testing, secure later)
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# correct version (safe)
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
class ScanRequest(BaseModel):
    url: str

@app.post("/scan")
async def scan_url(request: ScanRequest):
    print(f"Scanning URL: {request.url}")
    
    schema_data = []
    visible_text = ""

    # 3. Scraper Logic
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            page = await browser.new_page()
            
            # Go to the URL
            await page.goto(request.url, timeout=30000)
            
            # Extract Schema
            schema_data = await page.evaluate("""() => {
                const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                return Array.from(scripts).map(s => s.innerText);
            }""")
            
            # Extract visible text
            visible_text = await page.inner_text("body")
            
            await browser.close()
            
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Scraping failed: {str(e)}")

    # 4. AI Logic
    if not schema_data:
        return {
            "status": "Fail",
            "summary": "No Schema Markup found on this page.",
            "risks": []
        }

    prompt = f"""
    You are a Google Search Quality Evaluator. Analyze the following.
    
    VISIBLE TEXT ON PAGE:
    {visible_text[:10000]} ... (truncated)
    
    SCHEMA FOUND:
    {schema_data}
    
    TASK:
    Detect "Spammy Structured Data" violations.
    1. HIDDEN CONTENT: Is there content in Schema not in visible text?
    2. IRRELEVANT TYPES: Is 'Organization' used on a blog post?
    3. SELF-SERVING REVIEWS: Is 'AggregateRating' used on the home page/organization?
    
    Return a valid JSON object with this structure:
    {{
        "status": "Pass" or "Fail",
        "summary": "Short summary of findings",
        "risks": [
            {{ "severity": "High", "issue": "Short title", "description": "Explanation" }}
        ]
    }}
    """

    try:
        completion = client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": "You are a helpful SEO compliance assistant. Always return valid JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={ "type": "json_object" }
        )
        
        import json
        analysis = json.loads(completion.choices[0].message.content)
        return analysis

    except Exception as e:
        print(e)
        raise HTTPException(status_code=500, detail="AI Analysis failed")
        
if __name__ == "__main__":
    import uvicorn
    # This runs the server directly when you run the script
    uvicorn.run(app, host="127.0.0.1", port=8000)

