import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeGreyAnalysisForPrompt } from "../src/modules/business-intelligence/conversation.routes.js";

test("removes unmapped-column patterns that may contain raw personal data", () => {
  const analysis = {
    status: "ok",
    metrics: { revenueTotal: 1200, customers: 4 },
    insights: [
      { type: "revenue", summary: "Revenue total is 1200." },
      { type: "column_patterns", summary: "Email (Customers): hacky@example.test (3)." },
      { type: "customers", summary: "4 distinct customers." }
    ]
  };

  const safe = sanitizeGreyAnalysisForPrompt(analysis);
  const serialized = JSON.stringify(safe);

  assert.equal(safe.insights.length, 2);
  assert.deepEqual(safe.insights.map(item => item.type), ["revenue", "customers"]);
  assert.equal(serialized.includes("hacky@example.test"), false);
});

test("handles missing or malformed analysis safely", () => {
  assert.equal(sanitizeGreyAnalysisForPrompt(null), null);
  assert.deepEqual(sanitizeGreyAnalysisForPrompt({ status: "ok" }), {
    status: "ok",
    insights: []
  });
});
