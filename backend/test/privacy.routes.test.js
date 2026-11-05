import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_ANON_KEY = "test-publishable-key";

const { app } = await import("../src/server.js");
const server = app.listen(0);
await new Promise(resolve => server.once("listening", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;

const cases = [
  ["GET", "/api/privacy/preferences"],
  ["PATCH", "/api/privacy/preferences", { setting: "shared_improvement_enabled", enabled: true }],
  ["GET", "/api/privacy/consent-events"],
  ["PATCH", "/api/privacy/conversations/00000000-0000-4000-8000-000000000000/shared-improvement", { excluded: true }]
];

for (const [method, path, body] of cases) {
  test(`${method} ${path} requires an authenticated user`, async () => {
    const response = await fetch(baseUrl + path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : {},
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const payload = await response.json();
    assert.equal(response.status, 401);
    assert.equal(payload.error, "authentication_required");
  });
}

test.after(async () => {
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
});
