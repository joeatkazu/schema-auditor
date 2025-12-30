import os
import asyncio
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

# Initialize OpenAI
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

class ScanRequest(BaseModel):
    url: str

@app.post("/scan")
async def scan_url(request: ScanRequest):
    print(f"Scanning URL: {request.url}")
    
    schema_data = []
    visible_text = ""

    # 3. Smart Scraper Logic (Updated for JS-heavy sites)
    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch(headless=True)
            
            # Use a real User-Agent so sites don't block the bot immediately
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            )
            page = await context.new_page()
            
            # Navigate to URL
            print("Navigating...")
            await page.goto(request.url, timeout=30000, wait_until="domcontentloaded")
            
            # CRITICAL FIX: Wait for background network calls to finish (up to 5s)
            # This gives the site time to inject the JSON-LD via JavaScript
            print("Waiting for JS to settle...")
            try:
                await page.wait_for_load_state('networkidle', timeout=5000)
            except:
                print("Network didn't fully settle, continuing anyway...")

            # EXTRA SAFEGUARD: Explicitly wait for the schema tag if it exists
            try:
                await page.wait_for_selector('script[type="application/ld+json"]', timeout=3000, state="attached")
                print("Found Schema tag!")
            except:
                print("No Schema tag appeared within timeout.")

            # Extract Schema
            schema_data = await page.evaluate("""() => {
                const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                return Array.from(scripts).map(s => s.innerText);
            }""")
            
            # Extract visible text (limit to 15k chars to save tokens)
            visible_text = await page.inner_text("body")
            
            await browser.close()
            
    except Exception as e:
        print(f"Scraping Error: {e}")
        # Return a cleaner error to the frontend
        raise HTTPException(status_code=400, detail=f"Could not scrape that URL. It might be blocking bots. Error: {str(e)}")

    # 4. AI Logic
    if not schema_data:
        return {
            "status": "Fail",
            "summary": "No Schema Markup found on this page (or it was blocked).",
            "risks": []
        }

    prompt = f"""
    You are a Google Search Quality Evaluator. Analyze the following.
    
    VISIBLE TEXT ON PAGE:
    {visible_text[:15000]} ... (truncated)
    
    SCHEMA FOUND:
    {schema_data}
    
    TASK:
    Detect "Spammy Structured Data" violations based on Google's specific guidelines.
    
    CHECK THESE SPECIFIC RULES:
    1. HIDDEN CONTENT (High Severity): Is there content in the Schema (like FAQ answers or reviews) that is NOT present in the visible text? This is a penalty trigger.
    2. IRRELEVANT TYPES (Medium Severity): Is 'Organization' or 'LocalBusiness' used on a purely informational blog post?
    3. SELF-SERVING REVIEWS (High Severity): Is 'AggregateRating' used on a 'LocalBusiness' or 'Organization' entity (unless it's a third-party directory)?
    4. MISMATCHED PRICES (High Severity): If there is 'Offer' schema, does the price match the text?
    
    Return a valid JSON object with this exact structure:
    {{
        "status": "Pass" or "Fail",
        "summary": "A 1-sentence summary of the finding.",
        "risks": [
            {{ "severity": "High" or "Medium" or "Low", "issue": "Short Title", "description": "Explanation of the violation" }}
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
    uvicorn.run(app, host="0.0.0.0", port=8000)