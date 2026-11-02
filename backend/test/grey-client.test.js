import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { askGrey, GreyClientError } from "../src/modules/business-intelligence/grey.client.js";

const URL_KEY = "GREY_SERVICE_URL";
const SECRET_KEY = "GREY_BUSINESSFLOW_JWT_SECRET";

function configure(t) {
  const oldUrl = process.env[URL_KEY];
  const oldSecret = process.env[SECRET_KEY];
  process.env[URL_KEY] = "https://grey.example";
  process.env[SECRET_KEY] = "test-secret-with-more-than-thirty-two-characters";
  t.after(() => {
    if (oldUrl === undefined) delete process.env[URL_KEY];
    else process.env[URL_KEY] = oldUrl;
    if (oldSecret === undefined) delete process.env[SECRET_KEY];
    else process.env[SECRET_KEY] = oldSecret;
  });
}

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

test("Grey client signs a short-lived tenant-scoped service token", async t => {
  configure(t);
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(String(url), "https://grey.example/api/integrations/businessflow/chat");
    const token = options.headers.Authorization.slice("Bearer ".length);
    const [header, payload, signature] = token.split(".");
    assert.deepEqual(decodeSegment(header), { alg: "HS256", typ: "JWT" });
    const claims = decodeSegment(payload);
    assert.equal(claims.iss, "businessflow-api");
    assert.equal(claims.aud, "grey-api");
    assert.equal(claims.sub, "user-123");
    assert.equal(claims.business_id, "business-456");
    assert.equal(claims.role, "business");
    assert.ok(claims.exp - claims.iat <= 90);
    const expected = createHmac("sha256", process.env[SECRET_KEY])
      .update(header + "." + payload).digest("base64url");
    assert.equal(signature, expected);
    const body = JSON.parse(options.body);
    assert.equal(body.message, "Review my retention goals");
    assert.equal(body.request_id, "11111111-1111-4111-8111-111111111111");
    assert.equal(body.workspace_context.business.name, "Example shop");
    return new Response(JSON.stringify({
      ok: true,
      response: "Start by measuring repeat purchases over 30 days.",
      tenant: "business-456",
      conversation_id: "grey-conversation-123"
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });

  const result = await askGrey({
    message: "Review my retention goals",
    userId: "user-123",
    businessId: "business-456",
    requestId: "11111111-1111-4111-8111-111111111111",
    workspaceContext: { business: { name: "Example shop" } }
  });
  assert.equal(result.content, "Start by measuring repeat purchases over 30 days.");
  assert.equal(result.conversationId, "grey-conversation-123");
});

test("Grey client refuses missing configuration", async t => {
  const oldUrl = process.env[URL_KEY];
  const oldSecret = process.env[SECRET_KEY];
  delete process.env[URL_KEY];
  delete process.env[SECRET_KEY];
  t.after(() => {
    if (oldUrl !== undefined) process.env[URL_KEY] = oldUrl;
    if (oldSecret !== undefined) process.env[SECRET_KEY] = oldSecret;
  });
  await assert.rejects(
    askGrey({ message: "Hello", userId: "u", businessId: "b", requestId: "11111111-1111-4111-8111-111111111111" }),
    error => error instanceof GreyClientError && error.code === "grey_not_configured"
  );
});

test("Grey client rejects insecure service origins", async t => {
  configure(t);
  process.env[URL_KEY] = "http://grey.example";
  await assert.rejects(
    askGrey({ message: "Hello", userId: "u", businessId: "b" }),
    error => error instanceof GreyClientError && error.code === "grey_invalid_config"
  );
});

test("Grey client rejects oversized context before sending a request", async t => {
  configure(t);
  let called = false;
  t.mock.method(globalThis, "fetch", async () => {
    called = true;
    return new Response("{}");
  });
  await assert.rejects(
    askGrey({ message: "Hello", userId: "u", businessId: "b", requestId: "11111111-1111-4111-8111-111111111111", workspaceContext: { notes: "x".repeat(17000) } }),
    error => error instanceof GreyClientError && error.code === "grey_context_too_large"
  );
  assert.equal(called, false);
});

test("Grey client rejects cross-tenant responses", async t => {
  configure(t);
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({
    ok: true, response: "Not for this tenant", tenant: "another-business", conversation_id: "c"
  }), { status: 200 }));
  await assert.rejects(
    askGrey({ message: "Hello", userId: "u", businessId: "b" }),
    error => error instanceof GreyClientError && /workspace identity/.test(error.message)
  );
});

test("Grey client fails closed on unavailable service", async t => {
  configure(t);
  t.mock.method(globalThis, "fetch", async () => new Response("unavailable", { status: 503 }));
  await assert.rejects(
    askGrey({ message: "Hello", userId: "u", businessId: "b" }),
    error => error instanceof GreyClientError && error.code === "grey_request_failed"
  );
});
