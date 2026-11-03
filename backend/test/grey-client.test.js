import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  createBusinessFlowToken,
  sendMessageToGrey,
  GreyIntegrationError
} from "../src/modules/business-intelligence/grey-client.js";

const secret = "test-secret-with-more-than-thirty-two-bytes";

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
  const old = {
    url: process.env.GREY_API_URL,
    secret: process.env.GREY_BUSINESSFLOW_JWT_SECRET,
    nodeEnv: process.env.NODE_ENV,
    fetch: globalThis.fetch
  };
  process.env.GREY_API_URL = "https://grey.example";
  process.env.GREY_BUSINESSFLOW_JWT_SECRET = secret;
  process.env.NODE_ENV = "test";
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url: String(url), options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      ok: true,
      response: "Grey response",
      conversation_id: "11111111-1111-4111-8111-111111111111",
      tenant: "22222222-2222-4222-8222-222222222222",
      replayed: false
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await sendMessageToGrey({
      userId: "user-1",
      businessId: "22222222-2222-4222-8222-222222222222",
      message: "Hello",
      requestId: "33333333-3333-4333-8333-333333333333",
      workspaceContext: { profile: {} }
    });
    assert.equal(captured.url, "https://grey.example/api/integrations/businessflow/chat");
    assert.equal(captured.body.request_id, "33333333-3333-4333-8333-333333333333");
    assert.match(captured.options.headers.authorization, /^Bearer /);
    assert.equal(result.response, "Grey response");
    assert.equal(result.conversationId, "11111111-1111-4111-8111-111111111111");
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
});

test("maps Grey service failures to retryable errors", async () => {
  const old = {
    url: process.env.GREY_API_URL,
    secret: process.env.GREY_BUSINESSFLOW_JWT_SECRET,
    fetch: globalThis.fetch
  };
  process.env.GREY_API_URL = "https://grey.example";
  process.env.GREY_BUSINESSFLOW_JWT_SECRET = secret;
  globalThis.fetch = async () => new Response("{}", { status: 503 });
  try {
    await assert.rejects(
      sendMessageToGrey({
        userId: "user-1",
        businessId: "business-1",
        message: "Hello",
        requestId: "33333333-3333-4333-8333-333333333333",
        workspaceContext: {}
      }),
      error => error instanceof GreyIntegrationError && error.status === 503 && error.retryable
    );
  } finally {
    globalThis.fetch = old.fetch;
    if (old.url === undefined) delete process.env.GREY_API_URL;
    else process.env.GREY_API_URL = old.url;
    if (old.secret === undefined) delete process.env.GREY_BUSINESSFLOW_JWT_SECRET;
    else process.env.GREY_BUSINESSFLOW_JWT_SECRET = old.secret;
  }
});
