import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-publishable-key";

const { app } = await import("../src/server.js");
const server = app.listen(0);
await new Promise(resolve => server.once("listening", resolve));
const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;

test("Business Intelligence health reports only implemented capabilities", async () => {
  const response = await fetch(`${baseUrl}/api/business-intelligence/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.capabilities.profilePersistence, true);
  assert.equal(body.capabilities.goalsPersistence, true);
  assert.equal(body.capabilities.experimentsPersistence, true);
  assert.equal(body.capabilities.persistentBusinessMemory, true);
  assert.equal(body.capabilities.liveBusinessAnalytics, true);
  assert.equal(body.capabilities.ruleBasedRecommendations, true);
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


for (const endpoint of [
  "/api/business-intelligence/goals?business_id=00000000-0000-4000-8000-000000000000",
  "/api/business-intelligence/experiments?business_id=00000000-0000-4000-8000-000000000000",
  "/api/business-intelligence/memory?business_id=00000000-0000-4000-8000-000000000000"
]) {
  test(`collection ${endpoint.split("?")[0]} requires authentication`, async () => {
    const response = await fetch(`${baseUrl}${endpoint}`);
    const body = await response.json();
    assert.equal(response.status, 401);
    assert.equal(body.error, "authentication_required");
  });
}

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
});


test("dataset import endpoints require authentication", async () => {
  const listResponse = await fetch(`${baseUrl}/api/business-intelligence/imports?business_id=00000000-0000-4000-8000-000000000000`);
  assert.equal(listResponse.status, 401);
  assert.equal((await listResponse.json()).error, "authentication_required");
  const saveResponse = await fetch(`${baseUrl}/api/business-intelligence/imports`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ business_id: "00000000-0000-4000-8000-000000000000", name: "test", source_filename: "test.csv", columns: ["name"], column_mapping: {}, rows: [{ name: "A" }] })
  });
  assert.equal(saveResponse.status, 401);
  assert.equal((await saveResponse.json()).error, "authentication_required");
});


test("business insights require authentication", async () => {
  const response = await fetch(`${baseUrl}/api/business-intelligence/insights?business_id=00000000-0000-4000-8000-000000000000`);
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "authentication_required");
});

for (const endpoint of [
  "/api/business-intelligence/conversations?business_id=00000000-0000-4000-8000-000000000000",
  "/api/business-intelligence/conversations/00000000-0000-4000-8000-000000000000/messages"
]) {
  test(`conversation endpoint ${endpoint.split("?")[0]} requires authentication`, async () => {
    const response = await fetch(`${baseUrl}${endpoint}`);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "authentication_required");
  });
}

test("conversation creation requires authentication", async () => {
  const response = await fetch(`${baseUrl}/api/business-intelligence/conversations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ business_id: "00000000-0000-4000-8000-000000000000", title: "Test" })
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "authentication_required");
});

test("conversation message creation requires authentication", async () => {
  const response = await fetch(`${baseUrl}/api/business-intelligence/conversations/00000000-0000-4000-8000-000000000000/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: "Hello", client_message_id: "00000000-0000-4000-8000-000000000000" })
  });
  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "authentication_required");
});
