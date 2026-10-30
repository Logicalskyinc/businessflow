import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, createPublicKey, verify } from "node:crypto";
import { createGreyServiceToken } from "../src/integrations/grey-service-token.js";

function decodeSegment(segment) {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

test("creates a short-lived HS256 token with scoped BusinessFlow claims", () => {
  const secret = "test-secret-that-is-at-least-thirty-two-characters";
  const token = createGreyServiceToken({
    userId: "supabase-user-123",
    businessId: "business-456",
    secret,
    now: 1000
  });
  const [header, payload, signature] = token.split(".");
  assert.deepEqual(decodeSegment(header), { alg: "HS256", typ: "JWT" });
  const claims = decodeSegment(payload);
  assert.equal(claims.iss, "businessflow-api");
  assert.equal(claims.aud, "grey-api");
  assert.equal(claims.sub, "supabase-user-123");
  assert.equal(claims.business_id, "business-456");
  assert.equal(claims.role, "business");
  assert.equal(claims.iat, 1000);
  assert.equal(claims.exp, 1060);
  assert.ok(claims.jti);
  const expected = createHmac("sha256", secret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  assert.equal(signature, expected);
});

test("rejects missing or weak signing secrets", () => {
  for (const secret of ["", "short", undefined]) {
    assert.throws(() => createGreyServiceToken({
      userId: "user-1", businessId: "business-1", secret
    }));
  }
});

test("rejects invalid user and business identifiers", () => {
  const secret = "test-secret-that-is-at-least-thirty-two-characters";
  assert.throws(() => createGreyServiceToken({ userId: "", businessId: "business-1", secret }));
  assert.throws(() => createGreyServiceToken({ userId: "user-1", businessId: "", secret }));
});
