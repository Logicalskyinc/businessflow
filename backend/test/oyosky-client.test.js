import test from "node:test";
import assert from "node:assert/strict";
import { askOyoSky, OyoSkyClientError } from "../src/modules/business-intelligence/oyosky.client.js";

const URL_KEY = "OYOSKY_SERVICE_URL";
const TOKEN_KEY = "OYOSKY_BUSINESSFLOW_SERVICE_TOKEN";

function configure(t) {
  const previousUrl = process.env[URL_KEY];
  const previousToken = process.env[TOKEN_KEY];
  process.env[URL_KEY] = "https://oyosky.example";
  process.env[TOKEN_KEY] = "test-businessflow-token";
  t.after(() => {
    if (previousUrl === undefined) delete process.env[URL_KEY];
    else process.env[URL_KEY] = previousUrl;
    if (previousToken === undefined) delete process.env[TOKEN_KEY];
    else process.env[TOKEN_KEY] = previousToken;
  });
}

function resultPayload(overrides = {}) {
  return {
    success: true,
    status: "analysis_with_insufficient_evidence",
    plan: { plan: [{ step: 1, description: "Review the current customer-retention baseline." }] },
    analysis: { uncertainties: ["No customer-retention dataset was supplied."] },
    orchestrator: "ORBIT",
    side_effects: { execution_performed: false, memory_written: false },
    ...overrides
  };
}

test("OYOSKY client sends a bounded workspace context with a server bearer token", async t => {
  configure(t);
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(String(url), "https://oyosky.example/integrations/businessflow/reason");
    assert.equal(options.headers.Authorization, "Bearer test-businessflow-token");
    assert.equal(options.method, "POST");
    const payload = JSON.parse(options.body);
    assert.equal(payload.task, "How can I improve retention?");
    assert.equal(payload.context.business.name, "Example shop");
    return new Response(JSON.stringify(resultPayload()), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  });

  const answer = await askOyoSky("How can I improve retention?", {
    business: { name: "Example shop" },
    goals: []
  });

  assert.match(answer, /^OYOSKY \/ ATLAS ASSESSMENT/);
  assert.match(answer, /Review the current customer-retention baseline/);
  assert.match(answer, /No action was executed/);
});

test("OYOSKY client fails closed when service credentials are missing", async t => {
  const previousUrl = process.env[URL_KEY];
  const previousToken = process.env[TOKEN_KEY];
  delete process.env[URL_KEY];
  delete process.env[TOKEN_KEY];
  t.after(() => {
    if (previousUrl !== undefined) process.env[URL_KEY] = previousUrl;
    if (previousToken !== undefined) process.env[TOKEN_KEY] = previousToken;
  });

  await assert.rejects(
    askOyoSky("Review this business", {}),
    error => error instanceof OyoSkyClientError && error.code === "oyosky_not_configured"
  );
});

test("OYOSKY client rejects insecure service URLs", async t => {
  configure(t);
  process.env[URL_KEY] = "http://oyosky.example";
  await assert.rejects(
    askOyoSky("Review this business", {}),
    error => error instanceof OyoSkyClientError && error.code === "oyosky_invalid_config"
  );
});

test("OYOSKY client rejects oversized workspace context before network access", async t => {
  configure(t);
  let called = false;
  t.mock.method(globalThis, "fetch", async () => {
    called = true;
    return new Response("{}");
  });
  await assert.rejects(
    askOyoSky("Review this business", { notes: "x".repeat(25000) }),
    error => error instanceof OyoSkyClientError && error.code === "oyosky_context_too_large"
  );
  assert.equal(called, false);
});

test("OYOSKY client rejects non-success responses without fallback", async t => {
  configure(t);
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  await assert.rejects(
    askOyoSky("Review this business", {}),
    error => error instanceof OyoSkyClientError && error.code === "oyosky_request_failed"
  );
});

test("OYOSKY client rejects responses that claim side effects", async t => {
  configure(t);
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(resultPayload({
    side_effects: { execution_performed: true, memory_written: false }
  })), { status: 200 }));
  await assert.rejects(
    askOyoSky("Review this business", {}),
    error => error instanceof OyoSkyClientError && /read-only safety/.test(error.message)
  );
});
