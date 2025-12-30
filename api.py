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
    page_title = "Unknown"

    # 3. Smart "Stealth" Scraper Logic
    try:
        async with async_playwright() as p:
            # STEALTH MODE: 
            # We disable flags that scream "I am a robot" to security systems
            browser = await p.chromium.launch(
                headless=True,
                args=[
                    "--disable-blink-features=AutomationControlled", 
                    "--no-sandbox", 
                    "--disable-setuid-sandbox"
                ]
            )
            
            # Use a real User-Agent (Mac/Chrome) so we look like a normal laptop
            context = await browser.new_context(
                user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
                viewport={"width": 1280, "height": 720},
                device_scale_factor=2,
            )
            
            page = await context.new_page()
            
            # Add Headers to look more organic
            await page.set_extra_http_headers({
                "Accept-Language": "en-US,en;q=0.9",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
            })

            print("Navigating...")
            await page.goto(request.url, timeout=30000, wait_until="domcontentloaded")
            
            # Grab title to check if we were blocked later
            page_title = await page.title()
            print(f"PAGE TITLE IS: {page_title}")

            # Wait for JS to settle (up to 4s)
            print("Waiting for JS to settle...")
            try:
                await page.wait_for_load_state('networkidle', timeout=4000)
            except:
                pass

            # Extract Schema
            schema_data = await page.evaluate("""() => {
                const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                return Array.from(scripts).map(s => s.innerText);
            }""")
            
            # Extract visible text (limit to 15k chars)
            visible_text = await page.inner_text("body")
            
            await browser.close()
            
    except Exception as e:
        print(f"Scraping Error: {e}")
        # Return a helpful error if scraping totally crashes
        raise HTTPException(status_code=400, detail=f"Scraping failed. Error: {str(e)}")

    # ... (Scraper logic stays the same) ...

    # 4. AI Logic (Stricter "Ghost Hunter" Version)
    if not schema_data:
        return {
            "status": "Fail",
            "summary": f"No Schema Markup found. (Page Title: '{page_title}').",
            "risks": []
        }

    prompt = f"""
    You are a strict Google Search Quality Evaluator. Analyze the following SEO data.
    
    VISIBLE TEXT ON PAGE:
    {visible_text[:15000]} ... (truncated)
    
    SCHEMA FOUND:
    {schema_data}
    
    TASK:
    Detect "Spammy Structured Data" violations. You must be aggressive in flagging "Hidden" or "Manipulative" schema.
    
    CRITICAL RULES TO CHECK:
    1. GHOST RATINGS (High Severity): If 'AggregateRating' or 'Review' schema is present, SEARCH the Visible Text. Do you see the stars or rating count displayed? (e.g., If schema says "ratingCount": 50, but the text doesn't say "50 reviews", this is a VIOLATION).
    2. HIDDEN FAQ/CONTENT (High Severity): Is there content in the Schema (like FAQ answers) that is completely missing from the visible text?
    3. IRRELEVANT TYPES (Medium Severity): Is 'Organization', 'Product', or 'LocalBusiness' schema used on a purely informational blog post (like "Best X to Buy")? Blog posts should usually use 'Article' or 'BlogPosting'.
    4. SELF-SERVING REVIEWS (High Severity): Is the site rating ITSELF? (e.g. Organization schema with AggregateRating).
    
    OUTPUT FORMAT (JSON ONLY):
    {{
        "status": "Pass" or "Fail",
        "summary": "A 1-sentence summary. If you find Ghost Ratings, say 'Failed due to hidden review schema'.",
        "risks": [
            {{ "severity": "High", "issue": "Hidden Reviews", "description": "Schema claims 4.8 stars, but this rating is not visible to the user." }}
        ]
    }}
    """
    
    # ... (The rest of the file stays the same) ...
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
        print(f"AI Error: {e}")
        raise HTTPException(status_code=500, detail="AI Analysis failed")
        
if __name__ == "__main__":
    import uvicorn
    # 0.0.0.0 is critical for Render deployment
    uvicorn.run(app, host="0.0.0.0", port=8000)