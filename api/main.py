from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, HttpUrl
from playwright.sync_api import sync_playwright
from openai import OpenAI
import json
import os
from typing import List, Dict, Any, Optional
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = FastAPI()

# Initialize OpenAI client
openai_client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))


class Violation(BaseModel):
    severity: str  # High, Medium, Low
    description: str
    policy_reference: Optional[str] = None


class ScanRequest(BaseModel):
    url: HttpUrl


class ScanResponse(BaseModel):
    json_ld: List[Dict[str, Any]]
    visible_text: str
    violations: List[Violation]


def validate_schema_with_openai(json_ld: List[Dict[str, Any]], visible_text: str) -> List[Violation]:
    """
    Validate schema against Google's spam policies using OpenAI GPT-4o.
    """
    if not openai_client.api_key:
        raise HTTPException(
            status_code=500,
            detail="OpenAI API key not configured. Set OPENAI_API_KEY environment variable."
        )
    
    system_prompt = """You are a Google Search Quality Evaluator. Your job is to detect "Spammy Structured Data" that technically validates but violates Google's policies.

Inputs:
1. Schema JSON found on page.
2. Visible Text found on page.

Rules to Check:
1. HIDDEN CONTENT (High Severity): Compare the Schema values against the Visible Text. If the Schema contains marketing copy, FAQs, or descriptions that do not appear in the Visible Text, flag this.
2. IRRELEVANT TYPES (Medium Severity): If the page text clearly describes a blog post, but the Schema is "Organization" or "LocalBusiness", flag it.
3. SELF-SERVING REVIEWS (High Severity): Check if "LocalBusiness" or "Organization" entities have "AggregateRating" markup. This is a violation unless it is a third-party aggregator site.
4. MISLEADING OFFERS (High Severity): If Schema "Offer" price is lower than the price found in the Visible Text.

Output Format: JSON list of violations."""

    # Limit visible text to first 5000 chars to avoid token limits
    visible_text_limited = visible_text[:5000]
    
    user_prompt = f"""Analyze the following JSON-LD schema and visible text content for Google spam policy violations:

JSON-LD Schema:
{json.dumps(json_ld, indent=2)}

Visible Text Content:
{visible_text_limited}

Provide a JSON array of violations found."""

    try:
        # Update user prompt to request JSON format
        user_prompt_with_format = user_prompt + "\n\nReturn the violations as a JSON object with a 'violations' key containing an array of violation objects."
        
        response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt_with_format}
            ],
            response_format={"type": "json_object"},
            temperature=0.3
        )
        
        # Parse the response
        response_content = response.choices[0].message.content
        result = json.loads(response_content)
        
        # Handle both direct array and wrapped in object
        if isinstance(result, list):
            violations_data = result
        elif isinstance(result, dict) and "violations" in result:
            violations_data = result["violations"]
        else:
            violations_data = []
        
        # Convert to Violation objects
        violations = []
        for v in violations_data:
            if isinstance(v, dict):
                violations.append(Violation(
                    severity=v.get("severity", "Low"),
                    description=v.get("description", ""),
                    policy_reference=v.get("policy_reference")
                ))
        
        return violations
        
    except json.JSONDecodeError as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to parse OpenAI response: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"OpenAI API error: {str(e)}"
        )


@app.post("/scan", response_model=ScanResponse)
def scan_url(request: ScanRequest):
    """
    Scan a URL and extract JSON-LD script tags and visible text content.
    Validates the schema against Google's spam policies using OpenAI.
    """
    url = str(request.url)
    
    try:
        with sync_playwright() as p:
            # Launch browser
            browser = p.chromium.launch(headless=True)
            page = browser.new_page()
            
            # Navigate to URL
            page.goto(url, wait_until="networkidle")
            
            # Extract JSON-LD script tags
            json_ld_data = page.evaluate("""
                () => {
                    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
                    const jsonLd = [];
                    scripts.forEach(script => {
                        try {
                            const data = JSON.parse(script.textContent);
                            // Handle both single objects and arrays
                            if (Array.isArray(data)) {
                                jsonLd.push(...data);
                            } else {
                                jsonLd.push(data);
                            }
                        } catch (e) {
                            // Skip invalid JSON
                            console.error('Failed to parse JSON-LD:', e);
                        }
                    });
                    return jsonLd;
                }
            """)
            
            # Extract visible text content
            visible_text = page.evaluate("""
                () => {
                    // Remove script and style elements
                    const scripts = document.querySelectorAll('script, style, noscript');
                    scripts.forEach(el => el.remove());
                    
                    // Get body text content
                    const body = document.body;
                    if (!body) return '';
                    
                    // Get all text nodes that are visible
                    const walker = document.createTreeWalker(
                        body,
                        NodeFilter.SHOW_TEXT,
                        {
                            acceptNode: function(node) {
                                // Check if parent is visible
                                let parent = node.parentElement;
                                while (parent && parent !== body) {
                                    const style = window.getComputedStyle(parent);
                                    if (style.display === 'none' || 
                                        style.visibility === 'hidden' || 
                                        style.opacity === '0') {
                                        return NodeFilter.FILTER_REJECT;
                                    }
                                    parent = parent.parentElement;
                                }
                                return NodeFilter.FILTER_ACCEPT;
                            }
                        }
                    );
                    
                    const textParts = [];
                    let node;
                    while (node = walker.nextNode()) {
                        const text = node.textContent.trim();
                        if (text) {
                            textParts.push(text);
                        }
                    }
                    
                    // Join and clean up whitespace
                    return textParts.join(' ').replace(/\\s+/g, ' ').trim();
                }
            """)
            
            browser.close()
            
            # Validate schema with OpenAI
            violations = validate_schema_with_openai(json_ld_data, visible_text)
            
            return ScanResponse(
                json_ld=json_ld_data,
                visible_text=visible_text,
                violations=violations
            )
            
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error scanning URL: {str(e)}")


@app.get("/")
def root():
    return {"message": "Schema Auditor API", "endpoints": ["/scan"]}

