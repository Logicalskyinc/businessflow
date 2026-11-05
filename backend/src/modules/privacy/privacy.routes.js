import { Router } from "express";
import { requireAuthenticatedUser } from "../../middleware/require-authenticated-user.js";

export const privacyRouter = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACCOUNT_SETTINGS = new Set([
  "personal_learning_enabled",
  "shared_improvement_enabled",
  "conversation_history_enabled"
]);

privacyRouter.use(requireAuthenticatedUser);

privacyRouter.get("/preferences", async (req, res, next) => {
  try {
    const { data, error } = await req.supabase.rpc("businessflow_get_privacy_preferences");
    if (error) return next(error);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return res.status(503).json({ error: "privacy_preferences_unavailable" });
    }
    return res.json({ preferences: data });
  } catch (error) { return next(error); }
});

privacyRouter.patch("/preferences", async (req, res, next) => {
  try {
    const { setting, enabled, expected_revision: expectedRevision = null } = req.body ?? {};
    if (!ACCOUNT_SETTINGS.has(setting) || typeof enabled !== "boolean" ||
        (expectedRevision !== null && (!Number.isInteger(expectedRevision) || expectedRevision < 0))) {
      return res.status(400).json({ error: "invalid_privacy_preference" });
    }

    const { data, error } = await req.supabase.rpc("businessflow_set_privacy_preference", {
      p_setting: setting,
      p_enabled: enabled,
      p_expected_revision: expectedRevision
    });
    if (error?.code === "40001") {
      return res.status(409).json({ error: "privacy_preference_revision_conflict" });
    }
    if (error) return next(error);
    return res.json({ preferences: data });
  } catch (error) { return next(error); }
});

privacyRouter.get("/consent-events", async (req, res, next) => {
  try {
    const parsed = Number.parseInt(req.query.limit ?? "50", 10);
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 50;
    const { data, error } = await req.supabase.from("businessflow_privacy_consent_events")
      .select("id,subject_type,subject_id,setting,enabled,policy_version,revision,created_at")
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
    if (error) return next(error);
    return res.json({ events: data ?? [] });
  } catch (error) { return next(error); }
});

privacyRouter.patch("/conversations/:conversationId/shared-improvement", async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { excluded } = req.body ?? {};
    if (!UUID.test(conversationId) || typeof excluded !== "boolean") {
      return res.status(400).json({ error: "invalid_conversation_privacy_setting" });
    }

    const { data, error } = await req.supabase.rpc("businessflow_set_conversation_shared_exclusion", {
      p_conversation_id: conversationId,
      p_excluded: excluded
    });
    if (error?.code === "42501") {
      return res.status(404).json({ error: "conversation_not_found" });
    }
    if (error) return next(error);
    return res.json({ conversation_privacy: data });
  } catch (error) { return next(error); }
});
