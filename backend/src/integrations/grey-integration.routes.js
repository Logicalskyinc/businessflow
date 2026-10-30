import { Router } from "express";
import { requireAuthenticatedUser } from "../middleware/require-authenticated-user.js";
import { createGreyServiceToken } from "./grey-service-token.js";

export const greyIntegrationRouter = Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_ITEMS = 12;
const MAX_HISTORY_ITEM_LENGTH = 2000;

greyIntegrationRouter.post("/chat", requireAuthenticatedUser, async (req, res) => {
  const { business_id: businessId, message, history = [] } = req.body ?? {};

  if (typeof businessId !== "string" || !UUID.test(businessId)) {
    return res.status(400).json({ error: "invalid_business_id" });
  }
  if (typeof message !== "string" || !message.trim() || message.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: "invalid_message", message: "Message must contain 1 to 4000 characters." });
  }
  if (!Array.isArray(history) || history.length > MAX_HISTORY_ITEMS) {
    return res.status(400).json({ error: "invalid_history" });
  }
  const safeHistory = [];
  for (const item of history) {
    if (!item || typeof item !== "object" || Array.isArray(item) ||
        !["user", "assistant"].includes(item.role) ||
        typeof item.content !== "string" || !item.content.trim() ||
        item.content.length > MAX_HISTORY_ITEM_LENGTH) {
      return res.status(400).json({ error: "invalid_history" });
    }
    safeHistory.push({ role: item.role, content: item.content.trim() });
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
        body: JSON.stringify({ message: message.trim(), history: safeHistory }),
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
      source: typeof payload.source === "string" ? payload.source : "grey"
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
