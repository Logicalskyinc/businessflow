import { Router } from "express";
import { requireAuthenticatedUser } from "../../middleware/require-authenticated-user.js";
import { getOnboardingQuestions, validateOnboardingAnswers } from "./business-intelligence.service.js";
import { buildBusinessInsights } from "./business-intelligence.analytics.js";

export const businessIntelligenceRouter = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const goalStatuses = ["active", "paused", "completed", "archived"];
const experimentStatuses = ["draft", "planned", "running", "completed", "cancelled"];
const memoryCategories = ["business_context", "decision", "observation", "preference", "lesson", "experiment_result"];
const singularResource = { goals: "goal", experiments: "experiment", memory: "memory" };

businessIntelligenceRouter.get("/health", (_req, res) => res.json({
  module: "business-intelligence", status: "available",
  capabilities: { onboardingQuestions: true, answerValidation: true, profilePersistence: true,
    goalsPersistence: true, experimentsPersistence: true, persistentBusinessMemory: true, persistentConversations: true,
    liveBusinessAnalytics: true, ruleBasedRecommendations: true, aiReasoning: false, externalActions: false }
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
    const { count, error: countError } = await req.supabase.from("businessflow_profiles")
      .select("id", { count: "exact", head: true }).eq("owner_user_id", req.user.id);
    if (countError) return next(countError);
    if ((count ?? 0) >= 2) {
      return res.status(409).json({ error: "business_limit_reached", message: "Your Starter plan includes 2 businesses. Upgrade your plan to add another." });
    }
    const { data, error } = await req.supabase.from("businessflow_profiles").insert({
      owner_user_id: req.user.id, name, business_description: checked.answers.business_basics,
      primary_goal: checked.answers.primary_goal, onboarding_answers: checked.answers
    }).select("id,name,business_type,business_description,primary_goal,onboarding_answers,country_code,currency_code,created_at,updated_at").single();
    if (error?.code === "23514" && String(error.message).includes("businessflow_workspace_limit_reached")) {
      return res.status(409).json({ error: "business_limit_reached", message: "Your Starter plan includes 2 businesses. Upgrade your plan to add another." });
    }\n    if (error) return next(error);
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

businessIntelligenceRouter.get("/insights", requireAuthenticatedUser, async (req, res, next) => {
  try {
    const businessId = req.query.business_id;
    if (!uuid(businessId)) return bad(res, ["business_id must be a valid UUID."]);
    const [profileResult, importsResult, goalsResult, experimentsResult, memoryResult] = await Promise.all([
      req.supabase.from("businessflow_profiles").select("id,name,currency_code,primary_goal").eq("id", businessId).maybeSingle(),
      req.supabase.from("businessflow_imports").select("id,name,source_filename,column_mapping,rows,row_count").eq("business_id", businessId).order("created_at", { ascending: false }).limit(25),
      req.supabase.from("businessflow_goals").select("id,title,status,current_value,target_value,metric_name").eq("business_id", businessId).limit(100),
      req.supabase.from("businessflow_experiments").select("id,title,status,success_metric,result_summary").eq("business_id", businessId).limit(100),
      req.supabase.from("businessflow_memory").select("id,category,content,source,created_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(100)
    ]);
    for (const result of [profileResult, importsResult, goalsResult, experimentsResult, memoryResult]) {
      if (result.error) return next(result.error);
    }
    if (!profileResult.data) return res.status(404).json({ error: "business_not_found", message: "This business workspace is unavailable to your account." });
    return res.json(buildBusinessInsights({
      profile: profileResult.data, imports: importsResult.data || [], goals: goalsResult.data || [],
      experiments: experimentsResult.data || [], memory: memoryResult.data || []
    }));
  } catch (error) { return next(error); }
});

businessIntelligenceRouter.get("/imports/:id", requireAuthenticatedUser, async (req, res, next) => {
  try {
    if (!uuid(req.params.id) || !uuid(req.query.business_id)) return bad(res, ["A valid import id and business_id are required."]);
    const { data, error } = await req.supabase.from("businessflow_imports")
      .select("id,business_id,name,source_filename,columns,column_mapping,rows,row_count,created_at")
      .eq("id", req.params.id).eq("business_id", req.query.business_id).maybeSingle();
    if (error) return next(error);
    if (!data) return res.status(404).json({ error: "import_not_found" });
    return res.json({ status: "ok", import: data });
  } catch (e) { return next(e); }
});

businessIntelligenceRouter.get("/imports", requireAuthenticatedUser, async (req, res, next) => {
  try {
    if (!uuid(req.query.business_id)) return bad(res, ["business_id must be a valid UUID."]);
    const { data, error } = await req.supabase.from("businessflow_imports")
      .select("id,business_id,name,source_filename,columns,column_mapping,row_count,created_at")
      .eq("business_id", req.query.business_id).order("created_at", { ascending: false }).limit(50);
    if (error) return next(error);
    return res.json({ status: "ok", imports: data });
  } catch (e) { return next(e); }
});
businessIntelligenceRouter.post("/imports", requireAuthenticatedUser, async (req, res, next) => {
  try {
    if (!object(req.body) || !uuid(req.body.business_id)) return bad(res, ["A valid business_id is required."]);
    const { name, source_filename, columns, rows } = req.body;
    if (typeof name !== "string" || !name.trim() || name.trim().length > 160) return bad(res, ["Dataset name must contain 1 to 160 characters."]);
    if (typeof source_filename !== "string" || !source_filename.trim() || source_filename.length > 255) return bad(res, ["Source filename must contain 1 to 255 characters."]);
    if (!Array.isArray(columns) || columns.length < 1 || columns.length > 40 || columns.some(c => typeof c !== "string" || !c.trim() || c.length > 120)) return bad(res, ["Provide 1 to 40 valid column names."]);
    if (new Set(columns.map(c => c.trim().toLowerCase())).size !== columns.length) return bad(res, ["Column names must be unique."]);
    if (!object(req.body.column_mapping)) return bad(res, ["column_mapping must be a JSON object."]);
    const mappingValues = Object.values(req.body.column_mapping).filter(Boolean);
    const allowedMappings = new Set(["customer_name","email","phone","revenue","order_date","product","quantity","status","customer_id","location","notes"]);
    if (Object.keys(req.body.column_mapping).some(key => !columns.includes(key)) || mappingValues.some(value => typeof value !== "string" || !allowedMappings.has(value)) || new Set(mappingValues).size !== mappingValues.length) return bad(res, ["Column mapping contains unknown columns or duplicate/unsupported business fields."]);
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 250) return bad(res, ["Import must contain 1 to 250 data rows."]);
    const normalizedRows = [];
    for (const row of rows) {
      if (!object(row) || Object.keys(row).length !== columns.length) return bad(res, ["Every row must match the selected columns."]);
      const normalized = {};
      for (const column of columns) {
        const value = row[column];
        if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean" && value !== null) return bad(res, ["Cells must contain text, numbers, booleans, or empty values."]);
        const cell = value === null ? "" : String(value);
        if (cell.length > 1000) return bad(res, ["Each cell must be 1000 characters or fewer."]);
        normalized[column] = cell;
      }
      normalizedRows.push(normalized);
    }
    if (JSON.stringify(normalizedRows).length > 700000) return res.status(413).json({ error: "import_too_large", message: "Dataset is too large. Split it into smaller imports." });
    const { data, error } = await req.supabase.from("businessflow_imports").insert({
      business_id: req.body.business_id, created_by: req.user.id, name: name.trim(),
      source_filename: source_filename.trim(), columns: columns.map(c => c.trim()), column_mapping: req.body.column_mapping, rows: normalizedRows, row_count: normalizedRows.length
    }).select("id,business_id,name,source_filename,columns,column_mapping,row_count,created_at").single();
    if (error) return next(error);
    return res.status(201).json({ status: "created", import: data });
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
