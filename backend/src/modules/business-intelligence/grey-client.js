import { createHmac, randomUUID } from "node:crypto";

const GREY_CHAT_PATH = "/api/integrations/businessflow/chat";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

export function createBusinessFlowToken({ userId, businessId, secret, privacy, conversationExcluded = false, now = Math.floor(Date.now() / 1000) }) {
  if (!secret || Buffer.byteLength(secret) < 32) {
    throw new Error("GREY_BUSINESSFLOW_JWT_SECRET must contain at least 32 bytes.");
  }
  if (!userId || !businessId) throw new Error("Grey integration identity is incomplete.");

  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: "businessflow-api",
    aud: "grey-api",
    role: "business",
    sub: String(userId),
    business_id: String(businessId),
    privacy: {
      personal_learning_enabled: privacy?.personal_learning_enabled === true,
      shared_improvement_enabled: privacy?.shared_improvement_enabled === true,
      conversation_history_enabled: privacy?.conversation_history_enabled === true
    },
    shared_improvement_excluded: conversationExcluded === true,
    jti: randomUUID(),
    iat: now,
    exp: now + 90
  }));
  const unsigned = header + "." + payload;
  const signature = createHmac("sha256", secret).update(unsigned).digest("base64url");
  return unsigned + "." + signature;
}

export class GreyIntegrationError extends Error {
  constructor(message, status = 502, retryable = false) {
    super(message);
    this.name = "GreyIntegrationError";
    this.status = status;
    this.retryable = retryable;
  }
}

export async function sendMessageToGrey({
  userId,
  businessId,
  message,
  requestId,
  conversationId,
  workspaceContext,
  privacy,
  conversationExcluded = false
}) {
  const baseUrl = process.env.GREY_API_URL?.trim();
  const secret = process.env.GREY_BUSINESSFLOW_JWT_SECRET;
  if (!baseUrl || !secret || Buffer.byteLength(secret) < 32) {
    throw new GreyIntegrationError("Grey integration is not configured.", 503, true);
  }
  if (!UUID.test(requestId) || (conversationId && !UUID.test(conversationId))) {
    throw new GreyIntegrationError("Invalid Grey conversation request.", 400);
  }

  let endpoint;
  try {
    endpoint = new URL(GREY_CHAT_PATH, baseUrl);
    if (endpoint.protocol !== "https:" && process.env.NODE_ENV === "production") {
      throw new Error("HTTPS is required in production.");
    }
  } catch {
    throw new GreyIntegrationError("Grey integration URL is invalid.", 503, true);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const token = createBusinessFlowToken({ userId, businessId, secret, privacy, conversationExcluded });
    const body = { message, request_id: requestId, workspace_context: workspaceContext };
    if (conversationId) body.conversation_id = conversationId;

    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { authorization: "Bearer " + token, "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch {
      throw new GreyIntegrationError("Grey could not be reached. Retry this message.", 503, true);
    }

    let payload;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) {
      const retryable = response.status === 409 || response.status === 429 || response.status >= 500;
      if (retryable) throw new GreyIntegrationError("Grey is temporarily unable to process this message. Retry it.", 503, true);
      throw new GreyIntegrationError("Grey rejected the integration request. Check the server configuration.", 502);
    }

    if (!payload || payload.ok !== true || typeof payload.response !== "string" ||
        !payload.response.trim() || !UUID.test(payload.conversation_id) ||
        (payload.tenant && payload.tenant !== String(businessId))) {
      throw new GreyIntegrationError("Grey returned an invalid response.", 502);
    }
    return {
      response: payload.response.trim().slice(0, 7900),
      conversationId: payload.conversation_id,
      replayed: payload.replayed === true
    };
  } finally {
    clearTimeout(timeout);
  }
}
