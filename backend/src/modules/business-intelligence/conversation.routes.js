import { Router } from "express";
import { requireAuthenticatedUser } from "../../middleware/require-authenticated-user.js";
import { buildBusinessInsights } from "./business-intelligence.analytics.js";
import { formatBusinessFlowAiReply, reasonAboutBusiness } from "./businessflow-ai.service.js";

export const conversationRouter = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = value => typeof value === "string" && UUID.test(value);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

conversationRouter.use(requireAuthenticatedUser);

conversationRouter.get("/", async (req, res, next) => {
  try {
    if (!isUuid(req.query.business_id)) return res.status(400).json({ error: "invalid_business_id" });
    const { data, error } = await req.supabase.from("businessflow_conversations")
      .select("id,business_id,title,created_at,updated_at")
      .eq("business_id", req.query.business_id).order("updated_at", { ascending: false }).limit(50);
    if (error) return next(error);
    return res.json({ conversations: data ?? [] });
  } catch (error) { return next(error); }
});

conversationRouter.post("/", async (req, res, next) => {
  try {
    if (!isObject(req.body) || !isUuid(req.body.business_id)) {
      return res.status(400).json({ error: "invalid_business_id" });
    }
    const title = typeof req.body.title === "string" ? req.body.title.trim() : "New conversation";
    if (!title || title.length > 120) return res.status(400).json({ error: "invalid_title" });
    const { data, error } = await req.supabase.from("businessflow_conversations")
      .insert({ business_id: req.body.business_id, created_by: req.user.id, title })
      .select("id,business_id,title,created_at,updated_at").single();
    if (error) return next(error);
    return res.status(201).json({ conversation: data });
  } catch (error) { return next(error); }
});

conversationRouter.get("/:conversationId/messages", async (req, res, next) => {
  try {
    if (!isUuid(req.params.conversationId)) return res.status(400).json({ error: "invalid_conversation_id" });
    const parsed = Number.parseInt(req.query.limit ?? "100", 10);
    const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 100;
    const { data, error } = await req.supabase.from("businessflow_messages")
      .select("id,conversation_id,role,content,created_at")
      .eq("conversation_id", req.params.conversationId)
      .order("created_at", { ascending: true }).limit(limit);
    if (error) return next(error);
    if (!data) return res.status(404).json({ error: "conversation_not_found" });
    return res.json({ messages: data ?? [] });
  } catch (error) { return next(error); }
});

conversationRouter.post("/:conversationId/messages", async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const { content, client_message_id: clientMessageId } = req.body ?? {};
    if (!isUuid(conversationId)) return res.status(400).json({ error: "invalid_conversation_id" });
    if (typeof content !== "string" || !content.trim() || content.trim().length > 8000) {
      return res.status(400).json({ error: "invalid_message", message: "Message must contain 1 to 8,000 characters." });
    }
    if (!isUuid(clientMessageId)) return res.status(400).json({ error: "invalid_client_message_id" });

    const { data: conversation, error: conversationError } = await req.supabase.from("businessflow_conversations")
      .select("id,business_id,title").eq("id", conversationId).maybeSingle();
    if (conversationError) return next(conversationError);
    if (!conversation) return res.status(404).json({ error: "conversation_not_found" });

    let userMessage;
    const { data: inserted, error: insertError } = await req.supabase.from("businessflow_messages")
      .insert({ conversation_id: conversationId, created_by: req.user.id, role: "user", content: content.trim(), client_message_id: clientMessageId })
      .select("id,conversation_id,role,content,created_at").single();
    if (insertError?.code === "23505") {
      const { data, error } = await req.supabase.from("businessflow_messages")
        .select("id,conversation_id,role,content,created_at")
        .eq("conversation_id", conversationId).eq("client_message_id", clientMessageId).maybeSingle();
      if (error) return next(error);
      userMessage = data;
    } else if (insertError) return next(insertError);
    else userMessage = inserted;

    const { data: existingReply, error: replyLookupError } = await req.supabase.from("businessflow_messages")
      .select("id,conversation_id,role,content,created_at")
      .eq("reply_to_message_id", userMessage.id).maybeSingle();
    if (replyLookupError) return next(replyLookupError);
    if (existingReply) return res.json({ user_message: userMessage, assistant_message: existingReply, replayed: true });

    const answer = await buildBusinessFlowReply(req.supabase, conversation.business_id, userMessage.content);
    const { data: assistantMessage, error: assistantError } = await req.supabase.rpc("businessflow_append_assistant_message", {
      p_conversation_id: conversationId,
      p_reply_to_message_id: userMessage.id,
      p_content: answer
    });
    if (assistantError) return next(assistantError);

    const nextTitle = conversation.title === "New conversation" ? userMessage.content.slice(0, 80) : conversation.title;
    await req.supabase.from("businessflow_conversations").update({ title: nextTitle, updated_at: new Date().toISOString() }).eq("id", conversationId);
    return res.status(201).json({ user_message: userMessage, assistant_message: assistantMessage, replayed: false });
  } catch (error) { return next(error); }
});

async function buildBusinessFlowReply(supabase, businessId, prompt) {
  const [profileResult,importsResult,goalsResult,experimentsResult,memoryResult] = await Promise.all([
    supabase.from("businessflow_profiles").select("id,name,currency_code,primary_goal,business_description").eq("id",businessId).maybeSingle(),
    supabase.from("businessflow_imports").select("id,name,source_filename,column_mapping,rows,row_count").eq("business_id",businessId).order("created_at",{ascending:false}).limit(25),
    supabase.from("businessflow_goals").select("id,title,status,current_value,target_value,metric_name").eq("business_id",businessId).limit(100),
    supabase.from("businessflow_experiments").select("id,title,status,success_metric,result_summary").eq("business_id",businessId).limit(100),
    supabase.from("businessflow_memory").select("id,category,content,source,created_at").eq("business_id",businessId).order("created_at",{ascending:false}).limit(100)
  ]);
  for (const result of [profileResult,importsResult,goalsResult,experimentsResult,memoryResult]) if (result.error) throw result.error;
  if (!profileResult.data) throw new Error("Business workspace not found.");
  const insights = buildBusinessInsights({
    profile:profileResult.data, imports:importsResult.data || [], goals:goalsResult.data || [],
    experiments:experimentsResult.data || [], memory:memoryResult.data || []
  });
  const reasoning = reasonAboutBusiness({prompt,profile:profileResult.data,insights});
  return formatBusinessFlowAiReply(reasoning);
}
