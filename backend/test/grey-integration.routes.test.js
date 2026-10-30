import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createGreyIntegrationRouter } from "../src/integrations/grey-integration.routes.js";

const BUSINESS_ID = "123e4567-e89b-42d3-a456-426614174000";
const CONVERSATION_ID = "123e4567-e89b-42d3-a456-426614174001";
const USER_ID = "user-owner-123";
const SECRET = "test-secret-that-is-at-least-thirty-two-characters";

function createHarness({
  business = { id: BUSINESS_ID },
  databaseError = null,
  fetchImpl = async () => Response.json({
    ok: true,
    response: "Grey reply",
    conversation_id: CONVERSATION_ID
  }),
  historyTimeoutMs = 100,
  chatTimeoutMs = 100
} = {}) {
  const calls = [];
  const authenticate = (req, res, next) => {
    if (req.get("authorization") !== "Bearer test-user-token") {
      return res.status(401).json({ error: "authentication_required" });
    }
    req.user = { id: USER_ID };
    req.supabase = {
      from(table) {
        assert.equal(table, "businessflow_profiles");
        return {
          select(columns) {
            assert.equal(columns, "id");
            return {
              eq(column, value) {
                assert.equal(column, "id");
                calls.push({ businessId: value });
                return {
                  async maybeSingle() {
                    return { data: business, error: databaseError };
                  }
                };
              }
            };
          }
        };
      }
    };
    return next();
  };

  const app = express();
  app.use(express.json());
  app.use("/api/grey", createGreyIntegrationRouter({
    authenticate,
    fetchImpl: (...args) => fetchImpl(...args),
    tokenFactory: claims => {
      calls.push({ tokenClaims: claims });
      return "signed-test-service-token";
    },
    env: {
      GREY_API_URL: "https://grey.example.test",
      GREY_BUSINESSFLOW_JWT_SECRET: SECRET,
      NODE_ENV: "test"
    },
    historyTimeoutMs,
    chatTimeoutMs
  }));

  const server = app.listen(0, "127.0.0.1");
  return new Promise(resolve => {
    server.once("listening", () => {
      const address = server.address();
      resolve({
        calls,
        async close() {
          await new Promise((done, reject) => server.close(error => error ? reject(error) : done()));
        },
        request(path, options = {}) {
          return fetch(`http://127.0.0.1:${address.port}${path}`, options);
        }
      });
    });
  });
}

function authHeaders(extra = {}) {
  return { Authorization: "Bearer test-user-token", ...extra };
}

test("rejects requests without an authenticated user", async () => {
  const harness = await createHarness();
  try {
    const response = await harness.request("/api/grey/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_id: BUSINESS_ID, message: "Hello" })
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "authentication_required" });
    assert.equal(harness.calls.length, 0);
  } finally {
    await harness.close();
  }
});

test("rejects access to a business not visible through the user's RLS-scoped client", async () => {
  const harness = await createHarness({ business: null });
  try {
    const response = await harness.request("/api/grey/chat", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ business_id: BUSINESS_ID, message: "Hello" })
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "business_not_found" });
    assert.equal(harness.calls.length, 1);
  } finally {
    await harness.close();
  }
});

test("forwards chat only after workspace access and signs the authenticated user and business", async () => {
  let upstreamRequest;
  const harness = await createHarness({
    fetchImpl: async (url, options) => {
      upstreamRequest = { url: String(url), options };
      return Response.json({
        ok: true,
        response: "Here is a practical next step.",
        source: "grey",
        conversation_id: CONVERSATION_ID
      });
    }
  });
  try {
    const response = await harness.request("/api/grey/chat", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json", "Idempotency-Key": "123e4567-e89b-42d3-a456-426614174099" }),
      body: JSON.stringify({
        business_id: BUSINESS_ID,
        message: "  Help me improve repeat purchases.  "
      })
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      status: "ok",
      response: "Here is a practical next step.",
      source: "grey",
      conversation_id: CONVERSATION_ID
    });
    assert.equal(upstreamRequest.url, "https://grey.example.test/api/integrations/businessflow/chat");
    assert.equal(upstreamRequest.options.method, "POST");
    assert.equal(upstreamRequest.options.headers.Authorization, "Bearer signed-test-service-token");
    assert.equal(upstreamRequest.options.headers["Idempotency-Key"], "123e4567-e89b-42d3-a456-426614174099");
    assert.deepEqual(JSON.parse(upstreamRequest.options.body), {
      message: "Help me improve repeat purchases.",
      conversation_id: null
    });
    assert.deepEqual(harness.calls.find(call => call.tokenClaims)?.tokenClaims, {
      userId: USER_ID,
      businessId: BUSINESS_ID,
      secret: SECRET
    });
  } finally {
    await harness.close();
  }
});

test("rejects chat requests without a valid idempotency key", async () => {
  const harness = await createHarness();
  try {
    const response = await harness.request("/api/grey/chat", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ business_id: BUSINESS_ID, message: "Hello" })
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_idempotency_key" });
    assert.equal(harness.calls.length, 0);
  } finally {
    await harness.close();
  }
});

test("validates chat input before calling Grey", async () => {
  const harness = await createHarness();
  try {
    const response = await harness.request("/api/grey/chat", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ business_id: BUSINESS_ID, message: "   " })
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "invalid_message");
    assert.equal(harness.calls.length, 0);
  } finally {
    await harness.close();
  }
});

test("proxies conversation history only after workspace access", async () => {
  let upstreamUrl;
  const harness = await createHarness({
    fetchImpl: async url => {
      upstreamUrl = String(url);
      return Response.json({ ok: true, conversations: [{ id: CONVERSATION_ID }] });
    }
  });
  try {
    const response = await harness.request(`/api/grey/conversations?business_id=${BUSINESS_ID}`, {
      headers: authHeaders()
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      conversations: [{ id: CONVERSATION_ID }]
    });
    assert.equal(upstreamUrl, "https://grey.example.test/api/integrations/businessflow/conversations");
  } finally {
    await harness.close();
  }
});

test("validates conversation IDs before making an upstream request", async () => {
  const harness = await createHarness();
  try {
    const response = await harness.request(`/api/grey/conversations/not-a-uuid?business_id=${BUSINESS_ID}`, {
      headers: authHeaders()
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: "invalid_conversation_id" });
    assert.equal(harness.calls.length, 0);
  } finally {
    await harness.close();
  }
});

test("maps an upstream timeout to a controlled gateway error", async () => {
  const harness = await createHarness({
    chatTimeoutMs: 5,
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      }, { once: true });
    })
  });
  try {
    const response = await harness.request("/api/grey/chat", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ business_id: BUSINESS_ID, message: "Hello Grey" })
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "grey_request_timeout");
  } finally {
    await harness.close();
  }
});

test("preserves Grey's 409 response for an uncertain idempotent request", async () => {
  const harness = await createHarness({
    fetchImpl: async () => Response.json({
      ok: false,
      error: "chat_request_in_progress",
      message: "Grey cannot safely run this request again automatically. Check the conversation before sending another message."
    }, { status: 409 })
  });
  try {
    const response = await harness.request("/api/grey/chat", {
      method: "POST",
      headers: authHeaders({
        "Content-Type": "application/json",
        "Idempotency-Key": "123e4567-e89b-42d3-a456-426614174099"
      }),
      body: JSON.stringify({ business_id: BUSINESS_ID, message: "Hello Grey" })
    });
    assert.equal(response.status, 409);
    assert.deepEqual(await response.json(), {
      error: "chat_request_in_progress",
      message: "Grey cannot safely run this request again automatically. Check the conversation before sending another message."
    });
  } finally {
    await harness.close();
  }
});

test("rejects malformed or unsuccessful Grey responses", async () => {
  const harness = await createHarness({
    fetchImpl: async () => Response.json({ ok: true, response: 42 })
  });
  try {
    const response = await harness.request("/api/grey/chat", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ business_id: BUSINESS_ID, message: "Hello Grey" })
    });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error, "grey_request_failed");
  } finally {
    await harness.close();
  }
});
