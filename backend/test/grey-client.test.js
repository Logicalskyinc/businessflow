import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  createBusinessFlowToken,
  sendMessageToGrey,
  GreyIntegrationError
} from "../src/modules/business-intelligence/grey-client.js";

const secret = "test-secret-with-more-than-thirty-two-bytes";
const businessId = "22222222-2222-4222-8222-222222222222";
const conversationId = "11111111-1111-4111-8111-111111111111";
const requestId = "33333333-3333-4333-8333-333333333333";

async function withGreyEnvironment(run, fetchImplementation) {
  const old = {
    url: process.env.GREY_API_URL,
    secret: process.env.GREY_BUSINESSFLOW_JWT_SECRET,
    nodeEnv: process.env.NODE_ENV,
    fetch: globalThis.fetch
  };
  process.env.GREY_API_URL = "https://grey.example";
  process.env.GREY_BUSINESSFLOW_JWT_SECRET = secret;
  process.env.NODE_ENV = "test";
  globalThis.fetch = fetchImplementation;
  try {
    return await run();
  } finally {
    globalThis.fetch = old.fetch;
    for (const [key, value] of [
      ["GREY_API_URL", old.url],
      ["GREY_BUSINESSFLOW_JWT_SECRET", old.secret],
      ["NODE_ENV", old.nodeEnv]
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function greyResponse(overrides = {}) {
  return new Response(JSON.stringify({
    ok: true,
    response: "Grey response",
    conversation_id: conversationId,
    tenant: businessId,
    replayed: false,
    ...overrides
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function request(overrides = {}) {
  return {
    userId: "user-1",
    businessId,
    message: "Hello",
    requestId,
    workspaceContext: { profile: {} },
    ...overrides
  };
}

test("creates short-lived HS256 tokens with unique request identifiers", () => {
  const args = { userId: "user-1", businessId: "business-1", secret, now: 1000 };
  const first = createBusinessFlowToken(args);
  const second = createBusinessFlowToken(args);
  const [header, payload, signature] = first.split(".");
  const unsigned = header + "." + payload;
  assert.equal(signature, createHmac("sha256", secret).update(unsigned).digest("base64url"));
  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "HS256", typ: "JWT" });
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  const secondClaims = JSON.parse(Buffer.from(second.split(".")[1], "base64url").toString());
  assert.equal(claims.iss, "businessflow-api");
  assert.equal(claims.aud, "grey-api");
  assert.equal(claims.role, "business");
  assert.equal(claims.sub, "user-1");
  assert.equal(claims.business_id, "business-1");
  assert.equal(claims.exp - claims.iat, 90);
  assert.notEqual(claims.jti, secondClaims.jti);
});

test("rejects weak signing secrets", () => {
  assert.throws(() => createBusinessFlowToken({
    userId: "user-1", businessId: "business-1", secret: "short"
  }));
});

test("sends authenticated requests and validates Grey's response", async () => {
  let captured;
  await withGreyEnvironment(async () => {
    const result = await sendMessageToGrey(request());
    assert.equal(captured.url, "https://grey.example/api/integrations/businessflow/chat");
    assert.equal(captured.body.request_id, requestId);
    assert.match(captured.options.headers.authorization, /^Bearer /);
    assert.equal(result.response, "Grey response");
    assert.equal(result.conversationId, conversationId);
  }, async (url, options) => {
    captured = { url: String(url), options, body: JSON.parse(options.body) };
    return greyResponse();
  });
});

test("keeps the same idempotency key and payload when a timed-out request is retried", async () => {
  const captured = [];
  await withGreyEnvironment(async () => {
    await assert.rejects(sendMessageToGrey(request()), error =>
      error instanceof GreyIntegrationError && error.status === 503 && error.retryable
    );
    const result = await sendMessageToGrey(request());
    assert.equal(result.response, "Grey response");
  }, async (_url, options) => {
    captured.push(JSON.parse(options.body));
    if (captured.length === 1) throw new TypeError("simulated connection reset");
    return greyResponse({ replayed: true });
  });

  assert.equal(captured.length, 2);
  assert.equal(captured[0].request_id, requestId);
  assert.equal(captured[1].request_id, requestId);
  assert.deepEqual(captured[1], captured[0]);
});

test("concurrent retries preserve the same Grey idempotency key", async () => {
  const captured = [];
  await withGreyEnvironment(async () => {
    const results = await Promise.all([
      sendMessageToGrey(request()),
      sendMessageToGrey(request())
    ]);
    assert.equal(results.length, 2);
    assert.ok(results.every(result => result.response === "Grey response"));
  }, async (_url, options) => {
    captured.push(JSON.parse(options.body));
    await Promise.resolve();
    return greyResponse();
  });

  assert.equal(captured.length, 2);
  assert.deepEqual(captured[0], captured[1]);
  assert.ok(captured.every(body => body.request_id === requestId));
});

test("maps Grey service failures to retryable errors", async () => {
  await withGreyEnvironment(async () => {
    await assert.rejects(
      sendMessageToGrey(request()),
      error => error instanceof GreyIntegrationError && error.status === 503 && error.retryable
    );
  }, async () => new Response("{}", { status: 503 }));
});

test("maps network failures to retryable errors without changing the request ID", async () => {
  let capturedRequestId;
  await withGreyEnvironment(async () => {
    await assert.rejects(
      sendMessageToGrey(request()),
      error => error instanceof GreyIntegrationError && error.status === 503 && error.retryable
    );
  }, async (_url, options) => {
    capturedRequestId = JSON.parse(options.body).request_id;
    throw new TypeError("simulated network failure");
  });
  assert.equal(capturedRequestId, requestId);
});

test("rejects a Grey response belonging to a different tenant", async () => {
  await withGreyEnvironment(async () => {
    await assert.rejects(
      sendMessageToGrey(request()),
      error => error instanceof GreyIntegrationError && error.status === 502 && !error.retryable
    );
  }, async () => greyResponse({ tenant: "99999999-9999-4999-8999-999999999999" }));
});

test("rejects malformed successful responses", async () => {
  await withGreyEnvironment(async () => {
    await assert.rejects(
      sendMessageToGrey(request()),
      error => error instanceof GreyIntegrationError && error.status === 502
    );
  }, async () => greyResponse({ conversation_id: "not-a-uuid" }));
});
