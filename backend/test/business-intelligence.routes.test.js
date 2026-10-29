import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-publishable-key";

const { app } = await import("../src/server.js");
const server = app.listen(0);
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

test("Business Intelligence health reports only implemented capabilities", async () => {
  const response = await fetch(`${baseUrl}/api/business-intelligence/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.capabilities.profilePersistence, true);
  assert.equal(body.capabilities.persistentBusinessMemory, false);
  assert.equal(body.capabilities.liveBusinessAnalytics, false);
  assert.equal(body.capabilities.aiReasoning, false);
});

test("business listing requires a verified bearer token", async () => {
  const response = await fetch(`${baseUrl}/api/business-intelligence/businesses`);
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error, "authentication_required");
});

test("persistent onboarding requires a verified bearer token", async () => {
  const response = await fetch(`${baseUrl}/api/business-intelligence/onboarding`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Test business",
      answers: {
        business_basics: "A test shop",
        primary_goal: "More customers"
      }
    })
  });
  const body = await response.json();

  assert.equal(response.status, 401);
  assert.equal(body.error, "authentication_required");
});

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
});
