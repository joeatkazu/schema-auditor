# Schema Auditor API

FastAPI endpoint for scanning URLs and extracting JSON-LD and visible text content, with validation against Google's spam policies using OpenAI GPT-4o.

## Setup

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

2. Install Playwright browsers:
```bash
playwright install chromium
```

3. Set up OpenAI API key:
```bash
export export OPENAI_API_KEY="your_api_key_here"
```

Or create a `.env` file in the `api` directory:
```
OPENAI_API_KEY=your-api-key-here
```

## Running the API

```bash
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`

## Endpoints

### POST /scan

Scans a URL and extracts:
- All JSON-LD script tags (parsed as Python dictionaries)
- Visible text content (HTML tags, scripts, and styles removed)
- Validates schema against Google's spam policies and returns violations

**Request:**
```json
{
  "url": "https://example.com"
}
```

**Response:**
```json
{
  "json_ld": [
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      ...
    }
  ],
  "visible_text": "The visible text content of the page...",
  "violations": [
    {
      "severity": "High",
      "description": "Schema markup does not match visible content on page",
      "policy_reference": "Google Structured Data Guidelines - Misleading Content"
    }
  ]
}
```

**Violation Severity Levels:**
- **High**: Critical violations that could result in penalties or removal from search results
- **Medium**: Significant issues that may impact search visibility
- **Low**: Minor issues or best practice recommendations

### GET /

Returns API information.

