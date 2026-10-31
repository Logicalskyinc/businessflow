import { Router } from "express";
import { requireAuthenticatedUser } from "../../middleware/require-authenticated-user.js";
import { buildBusinessInsights } from "./business-intelligence.analytics.js";
import { formatBusinessFlowAiReply, reasonAboutBusiness } from "./businessflow-ai.service.js";

export const businessFlowAiRouter = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

businessFlowAiRouter.get("/health", (_req,res) => res.json({
  status:"ok", engine:"businessflow_ai_rules_v1", provider:"first_party_deterministic",
  externalProviderRequired:false, trainedLanguageModel:false
}));

for (const route of ["/analyze","/recommendations","/chat"]) {
  businessFlowAiRouter.post(route, requireAuthenticatedUser, async (req,res,next) => {
    try {
      if (!isObject(req.body) || !UUID.test(req.body.business_id || "")) {
        return res.status(400).json({ error:"invalid_business_id" });
      }
      if (route === "/chat" && (typeof req.body.prompt !== "string" || !req.body.prompt.trim() || req.body.prompt.trim().length > 8000)) {
        return res.status(400).json({ error:"invalid_prompt", message:"Prompt must contain 1 to 8,000 characters." });
      }
      const businessId = req.body.business_id;
      const [profileResult,importsResult,goalsResult,experimentsResult,memoryResult] = await Promise.all([
        req.supabase.from("businessflow_profiles").select("id,name,currency_code,primary_goal,business_description").eq("id",businessId).maybeSingle(),
        req.supabase.from("businessflow_imports").select("id,name,source_filename,column_mapping,rows,row_count").eq("business_id",businessId).order("created_at",{ascending:false}).limit(25),
        req.supabase.from("businessflow_goals").select("id,title,status,current_value,target_value,metric_name").eq("business_id",businessId).limit(100),
        req.supabase.from("businessflow_experiments").select("id,title,status,success_metric,result_summary").eq("business_id",businessId).limit(100),
        req.supabase.from("businessflow_memory").select("id,category,content,source,created_at").eq("business_id",businessId).order("created_at",{ascending:false}).limit(100)
      ]);
      for (const result of [profileResult,importsResult,goalsResult,experimentsResult,memoryResult]) if (result.error) return next(result.error);
      if (!profileResult.data) return res.status(404).json({error:"business_not_found"});
      const insights = buildBusinessInsights({
        profile:profileResult.data, imports:importsResult.data || [], goals:goalsResult.data || [],
        experiments:experimentsResult.data || [], memory:memoryResult.data || []
      });
      const reasoning = reasonAboutBusiness({
        prompt:route === "/chat" ? req.body.prompt.trim() : route === "/recommendations" ? "recommend business goals and next steps" : "analyze business performance",
        profile:profileResult.data, insights
      });
      if (route === "/chat") return res.json({ ...reasoning, reply:formatBusinessFlowAiReply(reasoning) });
      return res.json({ ...reasoning, insights:insights.insights, metrics:insights.metrics, coverage:insights.coverage, dataQuality:insights.dataQuality });
    } catch(error) { return next(error); }
  });
}
