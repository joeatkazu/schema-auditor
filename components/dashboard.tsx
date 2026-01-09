"use client"

import { useState } from "react"

interface Violation {
  severity: "High" | "Medium" | "Low"
  issue: string
  description: string
  policy_reference?: string
}

interface AuditResponse {
  status: "Pass" | "Fail"
  summary: string
  json_ld: any[]
  visible_text: string
  risks: Violation[]
  page_title: string
}

export default function Page() {
  const [url, setUrl] = useState("")
  const [isScanning, setIsScanning] = useState(false)
  const [results, setResults] = useState<AuditResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const handleScan = async () => {
    if (!url) return

    setIsScanning(true)
    setError(null)
    setResults(null)

    try {
      const response = await fetch("/api/audit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url }),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: "Unknown error" }))
        throw new Error(errorData.error || `Failed to scan URL: ${response.statusText}`)
      }

      const data: AuditResponse = await response.json()
      setResults(data)
    } catch (err: any) {
      console.error("Scan error:", err)
      setError(err.message || "Something went wrong. Please try again.")
    } finally {
      setIsScanning(false)
    }
  }

  // Extract schema types from JSON-LD data
  const getSchemaTypes = (jsonLd: any[]) => {
    const typeMap = new Map<string, number>()
    
    jsonLd.forEach((schema) => {
      const type = schema["@type"] || "Unknown"
      typeMap.set(type, (typeMap.get(type) || 0) + 1)
    })

    return Array.from(typeMap.entries()).map(([type, count]) => ({
      type,
      count,
      status: "valid" as const, // Schemas are considered valid if they exist
    }))
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      <div className="mx-auto max-w-6xl px-4 py-12">
        {/* Header */}
        <div className="mb-12 text-center">
          <h1 className="mb-3 text-5xl font-bold tracking-tight text-slate-900">SEO Schema Auditor</h1>
          <p className="text-lg text-slate-600">Analyze and validate structured data on any webpage</p>
        </div>

        {/* Input Section */}
        <div className="mb-8 rounded-2xl bg-white p-8 shadow-lg shadow-slate-200/50">
          <div className="flex flex-col gap-4 sm:flex-row">
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
              className="flex-1 rounded-lg border-2 border-slate-200 px-6 py-4 text-lg text-slate-900 placeholder-slate-400 transition-colors focus:border-blue-500 focus:outline-none"
              onKeyDown={(e) => e.key === "Enter" && handleScan()}
            />
            <button
              onClick={handleScan}
              disabled={!url || isScanning}
              className="rounded-lg bg-blue-600 px-8 py-4 text-lg font-semibold text-white transition-all hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {isScanning ? (
                <span className="flex items-center gap-2">
                  <svg className="h-5 w-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    ></circle>
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    ></path>
                  </svg>
                  Scanning...
                </span>
              ) : (
                "Scan"
              )}
            </button>
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-8 rounded-2xl bg-red-50 border border-red-200 p-6 shadow-lg shadow-slate-200/50">
            <div className="flex items-start gap-3">
              <svg className="h-6 w-6 text-red-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
              <div>
                <h3 className="text-lg font-semibold text-red-900 mb-1">Error</h3>
                <p className="text-red-700">{error}</p>
              </div>
            </div>
          </div>
        )}

        {/* Results Section */}
        {results && (
          <div className="space-y-6">
            {/* Summary Card */}
            <div className="rounded-2xl bg-white p-8 shadow-lg shadow-slate-200/50">
              <div className="mb-6 flex items-start justify-between">
                <div>
                  <h2 className="mb-2 text-2xl font-bold text-slate-900">Scan Results</h2>
                  <p className="text-sm text-slate-500">{url}</p>
                  {results.page_title && (
                    <p className="text-xs text-slate-400 mt-1">Page: {results.page_title}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-1">{new Date().toLocaleString()}</p>
                </div>
                <span
                  className={`rounded-full px-4 py-2 text-sm font-semibold ${
                    results.status === "Pass"
                      ? "bg-green-100 text-green-700"
                      : "bg-red-100 text-red-700"
                  }`}
                >
                  {results.status}
                </span>
              </div>

              {/* Summary */}
              {results.summary && (
                <div className="mb-6 rounded-lg bg-slate-50 p-4 border border-slate-200">
                  <p className="text-sm text-slate-700">{results.summary}</p>
                </div>
              )}

              {/* Schemas Found */}
              {results.json_ld && results.json_ld.length > 0 && (
                <div className="mb-8">
                  <h3 className="mb-4 text-lg font-semibold text-slate-900">Schemas Found</h3>
                  <div className="space-y-3">
                    {getSchemaTypes(results.json_ld).map((schema, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-lg border border-slate-200 p-4"
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-2 w-2 rounded-full bg-green-500"></div>
                          <span className="font-medium text-slate-900">{schema.type}</span>
                        </div>
                        <div className="flex items-center gap-4">
                          <span className="text-sm text-slate-500">
                            {schema.count} instance{schema.count !== 1 ? "s" : ""}
                          </span>
                          <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-semibold text-green-700">
                            {schema.status}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* No Schemas Found */}
              {(!results.json_ld || results.json_ld.length === 0) && (
                <div className="mb-8 rounded-lg bg-yellow-50 border border-yellow-200 p-4">
                  <p className="text-sm text-yellow-800">
                    No JSON-LD schema markup found on this page.
                  </p>
                </div>
              )}

              {/* Issues & Recommendations */}
              {results.risks && results.risks.length > 0 && (
                <div>
                  <h3 className="mb-4 text-lg font-semibold text-slate-900">
                    Violations & Issues
                  </h3>
                  <div className="space-y-3">
                    {results.risks.map((risk, idx) => (
                      <div
                        key={idx}
                        className={`flex gap-3 rounded-lg border p-4 ${
                          risk.severity === "High"
                            ? "border-red-200 bg-red-50"
                            : risk.severity === "Medium"
                            ? "border-yellow-200 bg-yellow-50"
                            : "border-blue-200 bg-blue-50"
                        }`}
                      >
                        <div className="mt-0.5 flex-shrink-0">
                          {risk.severity === "High" && (
                            <svg
                              className="h-5 w-5 text-red-500"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                          {risk.severity === "Medium" && (
                            <svg
                              className="h-5 w-5 text-yellow-500"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                          {risk.severity === "Low" && (
                            <svg
                              className="h-5 w-5 text-blue-500"
                              fill="currentColor"
                              viewBox="0 0 20 20"
                            >
                              <path
                                fillRule="evenodd"
                                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className={`text-xs font-semibold px-2 py-0.5 rounded ${
                                risk.severity === "High"
                                  ? "bg-red-200 text-red-800"
                                  : risk.severity === "Medium"
                                  ? "bg-yellow-200 text-yellow-800"
                                  : "bg-blue-200 text-blue-800"
                              }`}
                            >
                              {risk.severity}
                            </span>
                            <span className="font-medium text-slate-900">{risk.issue}</span>
                          </div>
                          <p
                            className={`text-sm ${
                              risk.severity === "High"
                                ? "text-red-900"
                                : risk.severity === "Medium"
                                ? "text-yellow-900"
                                : "text-blue-900"
                            }`}
                          >
                            {risk.description}
                          </p>
                          {risk.policy_reference && (
                            <p className="text-xs text-slate-500 mt-1 italic">
                              Policy: {risk.policy_reference}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* No Issues */}
              {(!results.risks || results.risks.length === 0) && results.status === "Pass" && (
                <div className="rounded-lg bg-green-50 border border-green-200 p-4">
                  <p className="text-sm text-green-800">
                    ✓ No violations detected. The schema markup appears to comply with Google's spam policies.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!results && !isScanning && (
          <div className="rounded-2xl bg-white p-16 text-center shadow-lg shadow-slate-200/50">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-slate-100">
              <svg className="h-8 w-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
            <h3 className="mb-2 text-xl font-semibold text-slate-900">Ready to Scan</h3>
            <p className="text-slate-500">Enter a URL above to start analyzing structured data</p>
          </div>
        )}
      </div>
    </div>
  )
}
