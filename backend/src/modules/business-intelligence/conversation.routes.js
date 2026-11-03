import { Router } from "express";
import { requireAuthenticatedUser } from "../../middleware/require-authenticated-user.js";
import { GreyIntegrationError, sendMessageToGrey } from "./grey-client.js";

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
    if (typeof content !== "string" || !content.trim() || content.trim().length > 4000) {
      return res.status(400).json({ error: "invalid_message", message: "Message must contain 1 to 4,000 characters." });
    }
    if (!isUuid(clientMessageId)) return res.status(400).json({ error: "invalid_client_message_id" });

    const { data: conversation, error: conversationError } = await req.supabase.from("businessflow_conversations")
      .select("id,business_id,title,grey_conversation_id")
      .eq("id", conversationId).maybeSingle();
    if (conversationError) return next(conversationError);
    if (!conversation) return res.status(404).json({ error: "conversation_not_found" });

    let userMessage;
    const { data: inserted, error: insertError } = await req.supabase.from("businessflow_messages")
      .insert({
        conversation_id: conversationId, created_by: req.user.id, role: "user",
        content: content.trim(), client_message_id: clientMessageId
      })
      .select("id,conversation_id,role,content,created_at").single();
    if (insertError?.code === "23505") {
      const { data, error } = await req.supabase.from("businessflow_messages")
        .select("id,conversation_id,role,content,created_at")
        .eq("conversation_id", conversationId).eq("client_message_id", clientMessageId).maybeSingle();
      if (error) return next(error);
      userMessage = data;
    } else if (insertError) return next(insertError);
    else userMessage = inserted;
    if (!userMessage) return res.status(409).json({ error: "message_retry_conflict", retryable: true });
    if (userMessage.content !== content.trim()) {
      return res.status(409).json({
        error: "client_message_id_conflict",
        message: "This client_message_id was already used for different message content.",
        retryable: false
      });
    }

    const { data: existingReply, error: replyLookupError } = await req.supabase.from("businessflow_messages")
      .select("id,conversation_id,role,content,created_at")
      .eq("reply_to_message_id", userMessage.id).maybeSingle();
    if (replyLookupError) return next(replyLookupError);
    if (existingReply) return res.json({ user_message: userMessage, assistant_message: existingReply, replayed: true });

    try {
      const contextCandidate = await buildWorkspaceContext(req.supabase, conversation.business_id);
      const { data: workspaceContext, error: contextError } = await req.supabase.rpc("businessflow_set_message_context", {
        p_message_id: userMessage.id,
        p_context: contextCandidate
      });
      if (contextError) throw contextError;
      if (!workspaceContext || typeof workspaceContext !== "object") {
        throw new GreyIntegrationError("Business workspace context could not be saved.", 503, true);
      }
      let greyConversationId = conversation.grey_conversation_id;
      let initializationToken = null;
      if (!greyConversationId) {
        const { data: claim, error: claimError } = await req.supabase.rpc("businessflow_claim_grey_initialization", {
          p_conversation_id: conversationId
        });
        if (claimError) throw claimError;
        if (claim?.status === "busy") {
          throw new GreyIntegrationError("Another request is initializing Grey for this conversation. Retry shortly.", 503, true);
        }
        if (claim?.status === "claimed" && isUuid(claim.token)) {
          initializationToken = claim.token;
        } else if (claim?.status === "ready" && isUuid(claim.conversation_id)) {
          greyConversationId = claim.conversation_id;
        } else {
          throw new GreyIntegrationError("Grey conversation initialization returned an invalid state.", 502);
        }
      }

      let grey;
      try {
        grey = await sendMessageToGrey({
          userId: req.user.id,
          businessId: conversation.business_id,
          message: userMessage.content,
          requestId: clientMessageId,
          conversationId: greyConversationId,
          workspaceContext
        });
        if (initializationToken) {
          const { data: completed, error: completeError } = await req.supabase.rpc("businessflow_complete_grey_initialization", {
            p_conversation_id: conversationId,
            p_token: initializationToken,
            p_grey_conversation_id: grey.conversationId
          });
          if (completeError) throw completeError;
          if (completed !== true) {
            throw new GreyIntegrationError("Grey conversation ownership changed during initialization. Retry the message.", 503, true);
          }
        } else if (greyConversationId && grey.conversationId !== greyConversationId) {
          throw new GreyIntegrationError("Grey returned a different conversation than expected.", 502);
        }
      } catch (error) {
        if (initializationToken) {
          await req.supabase.rpc("businessflow_release_grey_initialization", {
            p_conversation_id: conversationId,
            p_token: initializationToken
          });
        }
        throw error;
      }

      const { data: assistantMessage, error: assistantError } = await req.supabase.rpc("businessflow_append_assistant_message", {
        p_conversation_id: conversationId,
        p_reply_to_message_id: userMessage.id,
        p_content: grey.response
      });
      if (assistantError) throw assistantError;

      const nextTitle = conversation.title === "New conversation" ? userMessage.content.slice(0, 80) : conversation.title;
      const { error: titleError } = await req.supabase.from("businessflow_conversations")
        .update({ title: nextTitle, updated_at: new Date().toISOString() }).eq("id", conversationId);
      if (titleError) throw titleError;

      return res.status(201).json({
        user_message: userMessage,
        assistant_message: assistantMessage,
        replayed: grey.replayed
      });
    } catch (error) {
      if (error instanceof GreyIntegrationError) {
        return res.status(error.status).json({
          error: error.status === 503 ? "grey_temporarily_unavailable" : "grey_integration_error",
          message: error.message,
          retryable: error.retryable
        });
      }
      return next(error);
    }
  } catch (error) { return next(error); }
});

async function buildWorkspaceContext(supabase, businessId) {
  const [profileResult, goalsResult, experimentsResult, memoryResult] = await Promise.all([
    supabase.from("businessflow_profiles").select("name,primary_goal,business_description").eq("id", businessId).maybeSingle(),
    supabase.from("businessflow_goals").select("title,status,current_value,target_value,metric_name").eq("business_id", businessId).limit(30),
    supabase.from("businessflow_experiments").select("title,status,success_metric,result_summary").eq("business_id", businessId).limit(20),
    supabase.from("businessflow_memory").select("category,content").eq("business_id", businessId).order("created_at", { ascending: false }).limit(12)
  ]);
  for (const result of [profileResult, goalsResult, experimentsResult, memoryResult]) {
    if (result.error) throw result.error;
  }
  if (!profileResult.data) throw new GreyIntegrationError("Business workspace not found.", 404);

  const context = {
    source: "BusinessFlow workspace records",
    profile: profileResult.data,
    goals: goalsResult.data ?? [],
    experiments: experimentsResult.data ?? [],
    memory: (memoryResult.data ?? []).map(item => ({
      category: item.category,
      content: (typeof item.content === "string" ? item.content : JSON.stringify(item.content)).slice(0, 700)
    }))
  };

  while (Buffer.byteLength(JSON.stringify(context), "utf8") > 11_000) {
    if (context.memory.length) context.memory.pop();
    else if (context.experiments.length) context.experiments.pop();
    else if (context.goals.length) context.goals.pop();
    else {
      context.profile.business_description = String(context.profile.business_description ?? "").slice(0, 500);
      context.profile.name = String(context.profile.name ?? "").slice(0, 100);
      context.profile.primary_goal = String(context.profile.primary_goal ?? "").slice(0, 300);
      break;
    }
  }
  return context;
}
