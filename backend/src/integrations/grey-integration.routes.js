import { Router } from "express";
import { requireAuthenticatedUser } from "../middleware/require-authenticated-user.js";
import { createGreyServiceToken } from "./grey-service-token.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_LENGTH = 4000;
const IDEMPOTENCY_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createGreyIntegrationRouter({
  authenticate = requireAuthenticatedUser,
  fetchImpl = (...args) => fetch(...args),
  tokenFactory = createGreyServiceToken,
  env = process.env,
  historyTimeoutMs = 15000,
  chatTimeoutMs = 20000
} = {}) {
  const router = Router();

  async function verifyWorkspaceAccess(req, res, businessId) {
    if (typeof businessId !== "string" || !UUID.test(businessId)) {
      res.status(400).json({ error: "invalid_business_id" });
      return false;
    }

    const { data: business, error } = await req.supabase
      .from("businessflow_profiles")
      .select("id")
      .eq("id", businessId)
      .maybeSingle();

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

  function createGreyEndpoint(path, res) {
    const greyApiUrl = env.GREY_API_URL?.trim();
    const signingSecret = env.GREY_BUSINESSFLOW_JWT_SECRET;
    if (!greyApiUrl || !signingSecret || signingSecret.length < 32) {
      res.status(503).json({ error: "grey_integration_not_configured" });
      return null;
    }

    try {
      const endpoint = new URL(path, greyApiUrl.endsWith("/") ? greyApiUrl : `${greyApiUrl}/`);
      if (endpoint.protocol !== "https:" && env.NODE_ENV === "production") {
        res.status(503).json({ error: "grey_integration_requires_https" });
        return null;
      }
      return { endpoint, signingSecret };
    } catch {
      res.status(503).json({ error: "grey_integration_not_configured" });
      return null;
    }
  }

  async function proxyHistory(req, res, businessId, path) {
    const config = createGreyEndpoint(path, res);
    if (!config) return;

    const token = tokenFactory({
      userId: req.user.id,
      businessId,
      secret: config.signingSecret
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), historyTimeoutMs);

    try {
      const upstream = await fetchImpl(config.endpoint, {
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
      res.status(502).json({ error: error?.name === "AbortError" ? "grey_request_timeout" : "grey_unavailable" });
    } finally {
      clearTimeout(timeout);
    }
  }

  router.get("/conversations", authenticate, async (req, res) => {
    try {
      const businessId = req.query.business_id;
      if (!await verifyWorkspaceAccess(req, res, businessId)) return;
      await proxyHistory(req, res, businessId, "/api/integrations/businessflow/conversations");
    } catch {
      res.status(503).json({ error: "workspace_verification_unavailable" });
    }
  });

  router.get("/conversations/:conversationId", authenticate, async (req, res) => {
    const { conversationId } = req.params;
    if (!UUID.test(conversationId)) {
      return res.status(400).json({ error: "invalid_conversation_id" });
    }

    try {
      const businessId = req.query.business_id;
      if (!await verifyWorkspaceAccess(req, res, businessId)) return;
      await proxyHistory(
        req,
        res,
        businessId,
        `/api/integrations/businessflow/conversations/${encodeURIComponent(conversationId)}`
      );
    } catch {
      res.status(503).json({ error: "workspace_verification_unavailable" });
    }
  });

  router.post("/chat", authenticate, async (req, res) => {
    const {
      business_id: businessId,
      message,
      conversation_id: conversationId = null
    } = req.body ?? {};

    if (typeof businessId !== "string" || !UUID.test(businessId)) {
      return res.status(400).json({ error: "invalid_business_id" });
    }
    if (typeof message !== "string" || !message.trim() || message.length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        error: "invalid_message",
        message: "Message must contain 1 to 4000 characters."
      });
    }
    if (conversationId !== null && (typeof conversationId !== "string" || !UUID.test(conversationId))) {
      return res.status(400).json({ error: "invalid_conversation_id" });
    }
    const idempotencyKey = req.get("Idempotency-Key");
    if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      return res.status(400).json({ error: "invalid_idempotency_key" });
    }

    try {
      if (!await verifyWorkspaceAccess(req, res, businessId)) return;

      const config = createGreyEndpoint("/api/integrations/businessflow/chat", res);
      if (!config) return;

      const token = tokenFactory({
        userId: req.user.id,
        businessId,
        secret: config.signingSecret
      });
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), chatTimeoutMs);

      let greyResponse;
      try {
        greyResponse = await fetchImpl(config.endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "Idempotency-Key": idempotencyKey
          },
          body: JSON.stringify({
            message: message.trim(),
            conversation_id: conversationId
          }),
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

  return router;
}

export const greyIntegrationRouter = createGreyIntegrationRouter();
