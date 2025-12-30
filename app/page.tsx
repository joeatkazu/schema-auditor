"use client"

import { useState } from "react"

export default function SchemaAuditor() {
  const [url, setUrl] = useState("")
  // We use 'any' here to keep it simple, but in a real app you'd define a type
  const [result, setResult] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  const handleScan = async () => {
    // 1. Reset states
    setLoading(true);
    setError("");
    setResult(null);

    try {
      // 2. Call your Python Backend
      const response = await fetch("https://schema-auditor.onrender.com/scan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: url }),
      });

      // 3. Handle Errors
      if (!response.ok) {
        // If the backend sent a detailed error, try to read it
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.detail || "Failed to connect to the server.");
      }

      // 4. Get Data
      const data = await response.json();
      setResult(data);

    } catch (err: any) {
      console.error(err);
      setError(err.message || "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8 font-sans">
      <div className="max-w-3xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold text-gray-900">Google Schema Compliance Auditor</h1>
          <p className="text-gray-500">Check if your structured data violates Google's Spam Policies.</p>
        </div>

        {/* Input Box */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 space-y-4">
          <div className="flex gap-2">
            <input 
              type="text" 
              placeholder="https://example.com/blog/my-post" 
              className="flex-1 px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button 
              onClick={handleScan}
              disabled={loading}
              className="bg-blue-600 text-white px-6 py-3 rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {loading ? "Scanning..." : "Scan Now"}
            </button>
          </div>
          {error && (
            <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-200">
                Error: {error}
            </div>
          )}
        </div>

        {/* Results Area */}
        {result && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200 space-y-4">
            
            {/* Status Badge */}
            <div className="flex items-center justify-between border-b border-gray-100 pb-4">
                <h2 className="text-xl font-bold">Audit Results</h2>
                <span className={`px-4 py-1.5 rounded-full text-sm font-bold tracking-wide ${
                    result.status === "Pass" 
                    ? "bg-green-100 text-green-700 border border-green-200" 
                    : "bg-red-100 text-red-700 border border-red-200"
                }`}>
                    {result.status.toUpperCase()}
                </span>
            </div>
            
            {/* Summary */}
            <div className="text-gray-700 font-medium">
                {result.summary}
            </div>

            {/* Risk List */}
            <div className="space-y-3 pt-2">
                {result.risks && result.risks.length > 0 ? (
                    result.risks.map((risk: any, i: number) => (
                        <div key={i} className="p-4 rounded-lg bg-red-50 border border-red-100 flex gap-4">
                            <div className="text-2xl">⚠️</div>
                            <div>
                                <div className="flex items-center gap-2 mb-1">
                                    <h3 className="font-bold text-red-900">{risk.issue}</h3>
                                    <span className="text-[10px] font-bold uppercase bg-red-200 text-red-800 px-2 py-0.5 rounded">
                                        {risk.severity}
                                    </span>
                                </div>
                                <p className="text-sm text-red-800">{risk.description}</p>
                            </div>
                        </div>
                    ))
                ) : (
                     <div className="p-6 bg-green-50 text-green-700 rounded-lg text-center border border-green-100">
                        ✅ Good job! No spam policy violations detected.
                     </div>
                )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}