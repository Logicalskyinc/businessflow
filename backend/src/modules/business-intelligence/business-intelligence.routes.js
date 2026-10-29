import { Router } from "express";
import { requireAuthenticatedUser } from "../../middleware/require-authenticated-user.js";
import { getOnboardingQuestions, validateOnboardingAnswers } from "./business-intelligence.service.js";

export const businessIntelligenceRouter = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const goalStatuses = ["active", "paused", "completed", "archived"];
const experimentStatuses = ["draft", "planned", "running", "completed", "cancelled"];
const memoryCategories = ["business_context", "decision", "observation", "preference", "lesson", "experiment_result"];
const singularResource = { goals: "goal", experiments: "experiment", memory: "memory" };

businessIntelligenceRouter.get("/health", (_req, res) => res.json({
  module: "business-intelligence", status: "available",
  capabilities: { onboardingQuestions: true, answerValidation: true, profilePersistence: true,
    goalsPersistence: true, experimentsPersistence: true, persistentBusinessMemory: true,
    liveBusinessAnalytics: false, aiReasoning: false, externalActions: false }
}));
businessIntelligenceRouter.get("/onboarding/questions", (_req, res) => res.json({ status: "ok", questions: getOnboardingQuestions() }));
businessIntelligenceRouter.post("/onboarding/validate", (req, res) => {
  const result = validateOnboardingAnswers(req.body);
  if (!result.valid) return bad(res, result.errors);
  return res.json({ status: "valid", message: "Validation only; nothing was saved.", answers: result.answers });
});

businessIntelligenceRouter.post("/onboarding", requireAuthenticatedUser, async (req, res, next) => {
  try {
    if (!object(req.body)) return bad(res, ["Request body must be a JSON object."]);
    const name = typeof req.body.name === "string" ? req.body.name.trim() : "";
    if (!name || name.length > 160) return bad(res, ["Business name must contain 1 to 160 characters."]);
    const checked = validateOnboardingAnswers(req.body.answers);
    if (!checked.valid) return bad(res, checked.errors);
    const { data, error } = await req.supabase.from("businessflow_profiles").insert({
      owner_user_id: req.user.id, name, business_description: checked.answers.business_basics,
      primary_goal: checked.answers.primary_goal, onboarding_answers: checked.answers
    }).select("id,name,business_type,business_description,primary_goal,onboarding_answers,country_code,currency_code,created_at,updated_at").single();
    if (error) return next(error);
    return res.status(201).json({ status: "created", business: data });
  } catch (e) { return next(e); }
});
businessIntelligenceRouter.get("/businesses", requireAuthenticatedUser, async (req, res, next) => {
  try {
    const { data, error } = await req.supabase.from("businessflow_profiles")
      .select("id,name,business_type,primary_goal,country_code,currency_code,created_at,updated_at")
      .order("created_at", { ascending: false });
    if (error) return next(error);
    return res.json({ status: "ok", businesses: data });
  } catch (e) { return next(e); }
});

addCrud("goals", "businessflow_goals", validateGoal);
addCrud("experiments", "businessflow_experiments", validateExperiment);
addCrud("memory", "businessflow_memory", validateMemory);

function addCrud(path, table, validator) {
  businessIntelligenceRouter.get("/" + path, requireAuthenticatedUser, async (req, res, next) => {
    try {
      if (!uuid(req.query.business_id)) return bad(res, ["business_id must be a valid UUID."]);
      const parsedLimit = Number.parseInt(req.query.limit ?? "50", 10);
      const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 100) : 50;
      const { data, error } = await req.supabase.from(table).select("*").eq("business_id", req.query.business_id)
        .order("created_at", { ascending: false }).limit(limit);
      if (error) return next(error);
      return res.json({ status: "ok", [path]: data });
    } catch (e) { return next(e); }
  });
  businessIntelligenceRouter.post("/" + path, requireAuthenticatedUser, async (req, res, next) => {
    try {
      if (!object(req.body) || !uuid(req.body.business_id)) return bad(res, ["A valid business_id is required."]);
      const checked = validator(req.body);
      if (!checked.valid) return bad(res, checked.errors);
      const payload = { ...checked.value, business_id: req.body.business_id, created_by: req.user.id };
      const { data, error } = await req.supabase.from(table).insert(payload).select("*").single();
      if (error) return next(error);
      return res.status(201).json({ status: "created", [singularResource[path]]: data });
    } catch (e) { return next(e); }
  });
  businessIntelligenceRouter.patch("/" + path + "/:id", requireAuthenticatedUser, async (req, res, next) => {
    try {
      if (!uuid(req.params.id)) return bad(res, ["Record id must be a valid UUID."]);
      if (!object(req.body)) return bad(res, ["Request body must be a JSON object."]);
      const checked = validator(req.body, true);
      if (!checked.valid) return bad(res, checked.errors);
      const payload = { ...checked.value };
      delete payload.business_id;
      delete payload.created_by;
      let query = req.supabase.from(table).update(payload).eq("id", req.params.id);
      if (req.body.business_id !== undefined) {
        if (!uuid(req.body.business_id)) return bad(res, ["business_id must be a valid UUID."]);
        query = query.eq("business_id", req.body.business_id);
      }
      const { data, error } = await query.select("*").maybeSingle();
      if (error) return next(error);
      if (!data) return res.status(404).json({ error: "record_not_found" });
      return res.json({ status: "updated", [path.slice(0, -1)]: data });
    } catch (e) { return next(e); }
  });
  businessIntelligenceRouter.delete("/" + path + "/:id", requireAuthenticatedUser, async (req, res, next) => {
    try {
      if (!uuid(req.params.id)) return bad(res, ["Record id must be a valid UUID."]);
      let query = req.supabase.from(table).delete().eq("id", req.params.id);
      if (req.query.business_id !== undefined) {
        if (!uuid(req.query.business_id)) return bad(res, ["business_id must be a valid UUID."]);
        query = query.eq("business_id", req.query.business_id);
      }
      const { data, error } = await query.select("id").maybeSingle();
      if (error) return next(error);
      if (!data) return res.status(404).json({ error: "record_not_found" });
      return res.json({ status: "deleted", id: data.id });
    } catch (e) { return next(e); }
  });
}

function validateGoal(input, partial = false) {
  return record(input, {
    title: v => text(v, 1, 200), description: v => nullableText(v, 4000),
    metric_name: v => nullableText(v, 120), target_value: v => v === null ? pass(null) : numeric(v),
    current_value: numeric, status: v => enumeration(v, goalStatuses), due_date: date(v)
  }, ["title"], partial, { current_value: 0, status: "active" });
}
function validateExperiment(input, partial = false) {
  return record(input, {
    title: v => text(v, 1, 200), hypothesis: v => nullableText(v, 4000),
    success_metric: v => nullableText(v, 500), status: v => enumeration(v, experimentStatuses),
    result_summary: v => nullableText(v, 8000), started_at: timestamp(v), completed_at: timestamp(v)
  }, ["title"], partial, { status: "draft" });
}
function validateMemory(input, partial = false) {
  if (!object(input)) return invalid(["Request body must be a JSON object."]);
  const errors = [], value = {};
  const allowed = new Set(["business_id", "category", "content", "source"]);
  for (const key of Object.keys(input)) if (!allowed.has(key)) errors.push("Unknown field: " + key + ".");
  if (input.category !== undefined) {
    if (!memoryCategories.includes(input.category)) errors.push("category is unsupported.");
    else value.category = input.category;
  } else if (!partial) errors.push("category is required.");
  if (input.content !== undefined) {
    if (!object(input.content)) errors.push("content must be a JSON object.");
    else if (JSON.stringify(input.content).length > 12000) errors.push("content is too large.");
    else value.content = input.content;
  } else if (!partial) errors.push("content is required.");
  if (input.source !== undefined) {
    if (!["user", "businessflow"].includes(input.source)) errors.push("source must be user or businessflow.");
    else value.source = input.source;
  } else if (!partial) value.source = "user";
  if (partial && !Object.keys(value).length) errors.push("At least one editable field is required.");
  return { valid: !errors.length, errors, value };
}
function record(input, fields, required, partial, defaults = {}) {
  if (!object(input)) return invalid(["Request body must be a JSON object."]);
  const errors = [], value = {};
  for (const [key, raw] of Object.entries(input)) {
    if (key === "business_id") continue;
    if (!(key in fields)) { errors.push("Unknown field: " + key + "."); continue; }
    const result = fields[key](raw);
    if (!result.valid) errors.push(key + ": " + result.error + ".");
    else value[key] = result.value;
  }
  if (!partial) {
    for (const key of required) if (!(key in value)) errors.push(key + " is required.");
    for (const [key, val] of Object.entries(defaults)) if (!(key in value)) value[key] = val;
  } else if (!Object.keys(value).length) errors.push("At least one editable field is required.");
  return { valid: !errors.length, errors, value };
}
function text(v, min, max) {
  if (typeof v !== "string") return fail("must be text");
  const s = v.trim(); return s.length >= min && s.length <= max ? pass(s) : fail("length must be " + min + "-" + max);
}
function nullableText(v, max) {
  if (v === null) return pass(null);
  if (typeof v !== "string") return fail("must be text or null");
  const s = v.trim(); return s.length <= max ? pass(s || null) : fail("too long");
}
function numeric(v) { return typeof v === "number" && Number.isFinite(v) ? pass(v) : fail("must be a finite number"); }
function enumeration(v, values) { return typeof v === "string" && values.includes(v) ? pass(v) : fail("unsupported value"); }
function date(v) {
  if (v === null) return pass(null);
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + "T00:00:00Z")) ? pass(v) : fail("must be YYYY-MM-DD or null");
}
function timestamp(v) {
  if (v === null) return pass(null);
  return typeof v === "string" && !Number.isNaN(Date.parse(v)) ? pass(new Date(v).toISOString()) : fail("must be a valid timestamp or null");
}
function object(v) { return v !== null && typeof v === "object" && !Array.isArray(v); }
function uuid(v) { return typeof v === "string" && UUID.test(v); }
function pass(value) { return { valid: true, value }; }
function fail(error) { return { valid: false, error }; }
function invalid(errors) { return { valid: false, errors, value: {} }; }
function bad(res, errors) { return res.status(400).json({ status: "invalid", errors }); }
