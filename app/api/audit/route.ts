import { NextRequest, NextResponse } from 'next/server';
import * as cheerio from 'cheerio';
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

interface Violation {
  severity: 'High' | 'Medium' | 'Low';
  issue: string;
  description: string;
  policy_reference?: string;
}

interface AuditResponse {
  status: 'Pass' | 'Fail';
  summary: string;
  json_ld: any[];
  visible_text: string;
  risks: Violation[];
  page_title: string;
}

interface ScanRequest {
  url: string;
}

/**
 * Extracts all JSON-LD script tags from HTML
 */
function extractJsonLd(html: string): any[] {
  const $ = cheerio.load(html);
  const jsonLdData: any[] = [];
  
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      const text = $(element).text().trim();
      if (text) {
        const parsed = JSON.parse(text);
        // Handle both single objects and arrays
        if (Array.isArray(parsed)) {
          jsonLdData.push(...parsed);
        } else {
          jsonLdData.push(parsed);
        }
      }
    } catch (e) {
      // Skip invalid JSON
      console.error('Failed to parse JSON-LD:', e);
    }
  });
  
  return jsonLdData;
}

/**
 * Extracts visible text content from HTML
 * Removes script, style, and hidden elements
 * Similar to Playwright's innerText which gets visible text recursively
 */
function extractVisibleText(html: string): string {
  const $ = cheerio.load(html);
  
  // Remove script, style, and noscript elements
  $('script, style, noscript, iframe, embed, object').remove();
  
  // Get the body element
  const $body = $('body');
  if (!$body.length) {
    return '';
  }
  
  // Get all text from body, which includes text from all nested visible elements
  // This is similar to Playwright's innerText() method
  let visibleText = $body.text();
  
  // Clean up whitespace - replace multiple spaces/newlines with single space
  visibleText = visibleText.replace(/\s+/g, ' ').trim();
  
  return visibleText;
}

/**
 * Validates schema against Google's spam policies using OpenAI
 */
async function validateSchemaWithOpenAI(
  jsonLd: any[],
  visibleText: string,
  pageTitle: string
): Promise<AuditResponse> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OpenAI API key not configured');
  }

  if (!jsonLd || jsonLd.length === 0) {
    return {
      status: 'Fail',
      summary: `No Schema Markup found. (Page Title: '${pageTitle}').`,
      json_ld: [],
      visible_text: visibleText.substring(0, 15000),
      risks: [],
      page_title: pageTitle,
    };
  }

  // Limit visible text to avoid token limits
  const visibleTextLimited = visibleText.substring(0, 15000);

  const systemPrompt = `You are a strict Google Search Quality Evaluator. Analyze the following SEO data and detect "Spammy Structured Data" violations. You must be aggressive in flagging "Hidden" or "Manipulative" schema.

CRITICAL RULES TO CHECK:
1. GHOST RATINGS (High Severity): If 'AggregateRating' or 'Review' schema is present, SEARCH the Visible Text. Do you see the stars or rating count displayed? (e.g., If schema says "ratingCount": 50, but the text doesn't mention "50 reviews" or show star ratings, this is a VIOLATION). Check for mismatched star ratings between schema and visible content.

2. HIDDEN FAQ/CONTENT (High Severity): Is there content in the Schema (like FAQ answers, descriptions, or other structured content) that is completely missing from the visible text? If FAQPage schema exists but no FAQ questions/answers are visible on the page, this is a violation.

3. MISSING FAQ (Medium Severity): If the page content suggests FAQs should be present (e.g., page title mentions "FAQ", content has question-like text, or page is clearly a support/help page) but no FAQPage schema is found, flag this as a missing FAQ opportunity.

4. IRRELEVANT TYPES (Medium Severity): Is 'Organization', 'Product', or 'LocalBusiness' schema used on a purely informational blog post (like "Best X to Buy")? Blog posts should usually use 'Article' or 'BlogPosting'.

5. SELF-SERVING REVIEWS (High Severity): Is the site rating ITSELF? (e.g. Organization schema with AggregateRating where the organization is rating itself, not a third-party aggregator).

6. MISLEADING OFFERS (High Severity): If Schema "Offer" price is mentioned, compare it with prices found in the Visible Text. Flag if inconsistent.

7. KEYWORD STUFFING (Medium Severity): Excessive or irrelevant keywords in schema properties that don't match the actual content.

For each violation, provide:
- severity: "High", "Medium", or "Low"
- issue: Short issue title (e.g., "Ghost Ratings", "Hidden FAQ Content")
- description: Clear explanation of the violation
- policy_reference: Reference to the specific Google policy violated (optional)

Return ONLY valid JSON.`;

  const userPrompt = `Analyze the following JSON-LD schema and visible text content for Google spam policy violations:

PAGE TITLE: ${pageTitle}

JSON-LD Schema:
${JSON.stringify(jsonLd, null, 2)}

Visible Text Content:
${visibleTextLimited} ... (truncated)

TASK:
Detect "Spammy Structured Data" violations. Pay special attention to:
- Mismatched star ratings (schema claims ratings that aren't visible)
- Hidden FAQ content (FAQ schema present but FAQs not visible)
- Missing FAQs (page should have FAQs but schema is missing)
- Self-serving reviews
- Misleading content

OUTPUT FORMAT (JSON ONLY):
{
  "status": "Pass" or "Fail",
  "summary": "A 1-sentence summary. If you find Ghost Ratings, say 'Failed due to hidden review schema'. If you find hidden FAQs, mention it.",
  "risks": [
    {
      "severity": "High",
      "issue": "Ghost Ratings",
      "description": "Schema claims 4.8 stars with 50 reviews, but no rating display is visible to users on the page.",
      "policy_reference": "Google Structured Data Guidelines - Hidden Content"
    }
  ]
}`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3,
    });

    const analysis = JSON.parse(completion.choices[0].message.content || '{}');

    return {
      status: analysis.status || 'Fail',
      summary: analysis.summary || 'Analysis completed',
      json_ld: jsonLd,
      visible_text: visibleTextLimited,
      risks: analysis.risks || [],
      page_title: pageTitle,
    };
  } catch (error: any) {
    console.error('OpenAI API error:', error);
    throw new Error(`AI Analysis failed: ${error.message}`);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: ScanRequest = await request.json();
    const { url } = body;

    if (!url) {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }

    // Validate URL format
    let validUrl: URL;
    try {
      validUrl = new URL(url);
    } catch {
      return NextResponse.json(
        { error: 'Invalid URL format' },
        { status: 400 }
      );
    }

    console.log(`Scanning URL: ${url}`);

    // Fetch HTML with realistic headers to avoid blocking
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      },
      // Add timeout
      signal: AbortSignal.timeout(30000), // 30 seconds
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL: ${response.status} ${response.statusText}` },
        { status: response.status }
      );
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract page title
    const pageTitle = $('title').text().trim() || 'Unknown';
    console.log(`PAGE TITLE IS: ${pageTitle}`);

    // Extract JSON-LD schema
    const jsonLdData = extractJsonLd(html);
    console.log(`Found ${jsonLdData.length} JSON-LD schemas`);

    // Extract visible text
    const visibleText = extractVisibleText(html);
    console.log(`Extracted ${visibleText.length} characters of visible text`);

    // Validate schema with OpenAI
    const auditResult = await validateSchemaWithOpenAI(
      jsonLdData,
      visibleText,
      pageTitle
    );

    return NextResponse.json(auditResult);
  } catch (error: any) {
    console.error('Scraping Error:', error);

    // Handle timeout errors
    if (error.name === 'AbortError' || error.name === 'TimeoutError') {
      return NextResponse.json(
        { error: 'Request timeout - URL took too long to respond' },
        { status: 408 }
      );
    }

    // Handle fetch errors
    if (error.message?.includes('fetch')) {
      return NextResponse.json(
        { error: `Failed to fetch URL: ${error.message}` },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
