import { Router } from "express";
import { requireAuthenticatedUser } from "../middleware/require-authenticated-user.js";
import { createGreyServiceToken } from "./grey-service-token.js";

export const greyIntegrationRouter = Router();

async function verifyWorkspaceAccess(req, res, businessId) {
  if (typeof businessId !== "string" || !UUID.test(businessId)) {
    res.status(400).json({ error: "invalid_business_id" });
    return false;
  }
  const { data: business, error } = await req.supabase
    .from("businessflow_profiles").select("id").eq("id", businessId).maybeSingle();
  if (error) {
    console.error("BusinessFlow Grey workspace verification failed.");
    res.status(503).json({ error: "workspace_verification_unavailable" });
    return false;
  }
  if (!business) {
    res.status(404).json({ error: "business_not_found" });
    return false;
  }
  return true;
}

async function callGrey(req, res, businessId, path, body = undefined) {
  const greyApiUrl = process.env.GREY_API_URL?.trim();
  const signingSecret = process.env.GREY_BUSINESSFLOW_JWT_SECRET;
  if (!greyApiUrl || !signingSecret || signingSecret.length < 32) {
    res.status(503).json({ error: "grey_integration_not_configured" });
    return;
  }
  let endpoint;
  try {
    endpoint = new URL(path, greyApiUrl.endsWith("/") ? greyApiUrl : `${greyApiUrl}/`);
    if (endpoint.protocol !== "https:" && process.env.NODE_ENV === "production") {
      res.status(503).json({ error: "grey_integration_requires_https" });
      return;
    }
  } catch {
    res.status(503).json({ error: "grey_integration_not_configured" });
    return;
  }
  const token = createGreyServiceToken({ userId: req.user.id, businessId, secret: signingSecret });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const upstream = await fetch(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: controller.signal
    });
    const payload = await upstream.json().catch(() => null);
    if (!upstream.ok || !payload || payload.ok !== true) {
      console.error("Grey conversation retrieval failed.", { status: upstream.status });
      res.status(upstream.status === 401 ? 503 : 502).json({ error: "grey_request_failed" });
      return;
    }
    res.json(payload);
  } catch (error) {
    console.error("BusinessFlow Grey history request failed.", { timedOut: error?.name === "AbortError" });
    res.status(502).json({ error: "grey_unavailable" });
  } finally {
    clearTimeout(timeout);
  }
}

greyIntegrationRouter.get("/conversations", requireAuthenticatedUser, async (req, res) => {
  const businessId = req.query.business_id;
  try {
    if (!await verifyWorkspaceAccess(req, res, businessId)) return;
    await callGrey(req, res, businessId, "/api/integrations/businessflow/conversations");
  } catch {
    res.status(503).json({ error: "workspace_verification_unavailable" });
  }
});

greyIntegrationRouter.get("/conversations/:conversationId", requireAuthenticatedUser, async (req, res) => {
  const businessId = req.query.business_id;
  if (!UUID.test(req.params.conversationId)) return res.status(400).json({ error: "invalid_conversation_id" });
  try {
    if (!await verifyWorkspaceAccess(req, res, businessId)) return;
    await callGrey(req, res, businessId, `/api/integrations/businessflow/conversations/${encodeURIComponent(req.params.conversationId)}`);
  } catch {
    res.status(503).json({ error: "workspace_verification_unavailable" });
  }
});


const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_LENGTH = 4000;

greyIntegrationRouter.post("/chat", requireAuthenticatedUser, async (req, res) => {
  const { business_id: businessId, message, conversation_id: conversationId = null } = req.body ?? {};

  if (typeof businessId !== "string" || !UUID.test(businessId)) {
    return res.status(400).json({ error: "invalid_business_id" });
  }
  if (typeof message !== "string" || !message.trim() || message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: "invalid_message", message: "Message must contain 1 to 4000 characters." });
  }
  if (conversationId !== null && (typeof conversationId !== "string" || !UUID.test(conversationId))) {
    return res.status(400).json({ error: "invalid_conversation_id" });
  }

  const greyApiUrl = process.env.GREY_API_URL?.trim();
  const signingSecret = process.env.GREY_BUSINESSFLOW_JWT_SECRET;
  if (!greyApiUrl || !signingSecret || signingSecret.length < 32) {
    return res.status(503).json({ error: "grey_integration_not_configured" });
  }

  try {
    const { data: business, error: businessError } = await req.supabase
      .from("businessflow_profiles")
      .select("id")
      .eq("id", businessId)
      .maybeSingle();

    if (businessError) {
      console.error("BusinessFlow Grey workspace verification failed.");
      return res.status(503).json({ error: "workspace_verification_unavailable" });
    }
    if (!business) {
      return res.status(404).json({ error: "business_not_found" });
    }

    const token = createGreyServiceToken({
      userId: req.user.id,
      businessId,
      secret: signingSecret
    });

    let endpoint;
    try {
      endpoint = new URL("/api/integrations/businessflow/chat", greyApiUrl);
      if (endpoint.protocol !== "https:" && process.env.NODE_ENV === "production") {
        return res.status(503).json({ error: "grey_integration_requires_https" });
      }
    } catch {
      return res.status(503).json({ error: "grey_integration_not_configured" });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let greyResponse;
    try {
      greyResponse = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify({ message: message.trim(), conversation_id: conversationId }),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }

    const payload = await greyResponse.json().catch(() => null);
    if (!greyResponse.ok || !payload || payload.ok !== true || typeof payload.response !== "string") {
      console.error("Grey integration returned a non-success response.", { status: greyResponse.status });
      return res.status(greyResponse.status === 401 ? 503 : 502).json({
        error: "grey_request_failed",
        message: "Grey is temporarily unavailable. Please try again."
      });
    }

    return res.json({
      status: "ok",
      response: payload.response,
      source: typeof payload.source === "string" ? payload.source : "grey",
      conversation_id: typeof payload.conversation_id === "string" ? payload.conversation_id : null
    });
  } catch (error) {
    const timedOut = error?.name === "AbortError";
    console.error("BusinessFlow Grey request failed.", { timedOut });
    return res.status(502).json({
      error: timedOut ? "grey_request_timeout" : "grey_unavailable",
      message: "Grey is temporarily unavailable. Please try again."
    });
  }
});
