import { createHmac, randomUUID } from "node:crypto";

const TIMEOUT_MS = 15000;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_CONTEXT_BYTES = 12000;
const MAX_RESPONSE_BYTES = 128000;

export class GreyClientError extends Error {
  constructor(message, code = "grey_unavailable") {
    super(message);
    this.name = "GreyClientError";
    this.code = code;
  }
}

function configuration() {
  const rawUrl = process.env.GREY_SERVICE_URL?.trim() ?? "";
  const secret = process.env.GREY_BUSINESSFLOW_JWT_SECRET?.trim() ?? "";
  if (!rawUrl || secret.length < 32) {
    throw new GreyClientError(
      "Grey is not connected. The server-side URL or signing secret is not configured.",
      "grey_not_configured"
    );
  }

  let base;
  try { base = new URL(rawUrl); }
  catch { throw new GreyClientError("GREY_SERVICE_URL must be a valid HTTPS origin.", "grey_invalid_config"); }

  if (base.protocol !== "https:" || !base.hostname || base.username || base.password ||
      base.search || base.hash || (base.pathname !== "/" && base.pathname !== "")) {
    throw new GreyClientError("GREY_SERVICE_URL must be a clean HTTPS origin.", "grey_invalid_config");
  }
  return { url: new URL("/api/integrations/businessflow/chat", base).toString(), secret };
}

function base64url(value) {
  return Buffer.from(value).toString("base64url");
}

function createServiceToken(secret, { userId, businessId }) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iss: "businessflow-api",
    aud: "grey-api",
    sub: userId,
    business_id: businessId,
    role: "business",
    iat: now,
    exp: now + 90,
    jti: randomUUID()
  }));
  const input = header + "." + payload;
  const signature = createHmac("sha256", secret).update(input).digest("base64url");
  return input + "." + signature;
}

async function readBoundedBody(response) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new GreyClientError("Grey returned a response larger than BusinessFlow accepts.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

export async function askGrey({ message, userId, businessId, requestId, conversationId = null, workspaceContext = {} }) {
  if (typeof message !== "string" || !message.trim() || message.trim().length > MAX_MESSAGE_LENGTH) {
    throw new GreyClientError("The Grey message must contain 1 to 4,000 characters.", "invalid_grey_request");
  }
  if (typeof userId !== "string" || !userId.trim() || userId.length > 100 ||
      typeof businessId !== "string" || !businessId.trim() || businessId.length > 100) {
    throw new GreyClientError("The authenticated BusinessFlow identity is invalid.", "invalid_grey_identity");
  }
  if (typeof requestId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new GreyClientError("A stable BusinessFlow message ID is required for safe retries.", "invalid_grey_request_id");
  }
  if (conversationId !== null && (typeof conversationId !== "string" || conversationId.length > 100)) {
    throw new GreyClientError("The linked Grey conversation ID is invalid.", "invalid_grey_conversation");
  }
  if (workspaceContext === null || typeof workspaceContext !== "object" || Array.isArray(workspaceContext)) {
    throw new GreyClientError("The selected workspace context must be an object.", "invalid_grey_context");
  }
  if (Buffer.byteLength(JSON.stringify(workspaceContext), "utf8") > MAX_CONTEXT_BYTES) {
    throw new GreyClientError("The selected workspace context is too large for Grey.", "grey_context_too_large");
  }

  const { url, secret } = configuration();
  const token = createServiceToken(secret, { userId, businessId });
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Content-Type": "application/json",
        Accept: "application/json"
      },
      body: JSON.stringify({
        message: message.trim(),
        request_id: requestId,
        conversation_id: conversationId,
        workspace_context: workspaceContext
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  } catch {
    throw new GreyClientError("BusinessFlow could not reach Grey. Your message is saved; retry when Grey is available.");
  }

  const raw = await readBoundedBody(response);
  let result;
  try { result = JSON.parse(raw.toString("utf8")); }
  catch { throw new GreyClientError("Grey returned an invalid response."); }

  if (!response.ok || result?.ok !== true) {
    const status = response.status;
    throw new GreyClientError(
      status === 503
        ? "Grey is unavailable or its persistent conversation storage is not configured."
        : "Grey could not complete this request (HTTP " + status + ").",
      status === 401 || status === 403 ? "grey_auth_rejected" : "grey_request_failed"
    );
  }
  if (typeof result.response !== "string" || !result.response.trim() ||
      typeof result.conversation_id !== "string" || !result.conversation_id) {
    throw new GreyClientError("Grey returned an incomplete conversation response.");
  }
  if (result.tenant !== businessId) {
    throw new GreyClientError("Grey returned a workspace identity that does not match this BusinessFlow request.");
  }

  return { content: result.response, conversationId: result.conversation_id };
}
