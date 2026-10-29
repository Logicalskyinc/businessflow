import test from "node:test";
import assert from "node:assert/strict";
import { requireAuthenticatedUser } from "../src/middleware/require-authenticated-user.js";

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

test("auth middleware fails closed when Supabase configuration is missing", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;

  try {
    const response = createResponse();
    let nextCalled = false;
    await requireAuthenticatedUser(
      { get: () => "Bearer token" },
      response,
      () => { nextCalled = true; }
    );

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.error, "authentication_not_configured");
    assert.equal(nextCalled, false);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = previousKey;
  }
});

test("auth middleware rejects requests without a bearer token", async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_ANON_KEY = "test-publishable-key";

  try {
    const response = createResponse();
    let nextCalled = false;
    await requireAuthenticatedUser(
      { get: () => undefined },
      response,
      () => { nextCalled = true; }
    );

    assert.equal(response.statusCode, 401);
    assert.equal(response.body.error, "authentication_required");
    assert.equal(nextCalled, false);
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = previousKey;
  }
});
