import { createHmac, randomUUID } from "node:crypto";

const ISSUER = "businessflow-api";
const AUDIENCE = "grey-api";
const TOKEN_TTL_SECONDS = 60;

/**
 * Sign a short-lived server-to-server token for Grey.
 * Call only after the authenticated Supabase client has verified access to
 * the requested BusinessFlow business workspace.
 */
export function createGreyServiceToken({ userId, businessId, secret, now = Math.floor(Date.now() / 1000) }) {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("Grey integration signing secret is not configured.");
  }
  if (typeof userId !== "string" || !userId.trim() || userId.length > 100) {
    throw new TypeError("A valid authenticated user ID is required.");
  }
  if (typeof businessId !== "string" || !businessId.trim() || businessId.length > 100) {
    throw new TypeError("A valid business ID is required.");
  }
  if (!Number.isInteger(now) || now < 0) {
    throw new TypeError("A valid token issue time is required.");
  }

  const encode = value => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    iss: ISSUER,
    aud: AUDIENCE,
    sub: userId.trim(),
    business_id: businessId.trim(),
    role: "business",
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
    jti: randomUUID()
  });
  const signingInput = `${header}.${payload}`;
  const signature = createHmac("sha256", secret).update(signingInput).digest("base64url");
  return `${signingInput}.${signature}`;
}
