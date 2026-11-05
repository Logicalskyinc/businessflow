import { Router } from "express";
import { createClient } from "@supabase/supabase-js";
import { requireAuthenticatedUser } from "../../middleware/require-authenticated-user.js";
import { GreyIntegrationError, sendMessageToGrey } from "./grey-client.js";
import { buildBusinessInsights } from "./business-intelligence.analytics.js";

export const conversationRouter = Router();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isUuid = value => typeof value === "string" && UUID.test(value);
const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

let greyStateClient;
function getGreyStateClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new GreyIntegrationError("Grey state storage is not configured on the server.", 503, true);
  }
  return greyStateClient ??= createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
  });
}

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
      .select("id,conversation_id,role,content,assistant_mode,created_at")
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
      .select("id,business_id,title,grey_conversation_id,grey_initialization_message_id")
      .eq("id", conversationId).maybeSingle();
    if (conversationError) return next(conversationError);
    if (!conversation) return res.status(404).json({ error: "conversation_not_found" });

    let userMessage;
    const { data: inserted, error: insertError } = await req.supabase.from("businessflow_messages")
      .insert({
        conversation_id: conversationId, created_by: req.user.id, role: "user",
        content: content.trim(), client_message_id: clientMessageId, assistant_mode: "grey"
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
      const greyState = getGreyStateClient();
      const { data: workspaceContext, error: contextError } = await greyState.rpc("businessflow_set_message_context", {
        p_message_id: userMessage.id,
        p_context: contextCandidate,
        p_user_id: req.user.id
      });
      if (contextError) throw contextError;
      if (!workspaceContext || typeof workspaceContext !== "object") {
        throw new GreyIntegrationError("Business workspace context could not be saved.", 503, true);
      }

      if (/\b(analy[sz](?:e|es|ed|ing|is)|based on (?:my )?(?:dataset|data)|analyse? (?:my )?(?:dataset|data))\b/i.test(userMessage.content)) {
        const answer = buildDatasetAnalysisReply(workspaceContext);
        const { data: assistantMessage, error: assistantError } = await req.supabase.rpc("businessflow_append_assistant_message", {
          p_conversation_id: conversationId,
          p_reply_to_message_id: userMessage.id,
          p_content: answer,
          p_assistant_mode: "grey"
        });
        if (assistantError) throw assistantError;
        const nextTitle = conversation.title === "New conversation" ? userMessage.content.slice(0, 80) : conversation.title;
        const { error: titleError } = await req.supabase.from("businessflow_conversations")
          .update({ title: nextTitle, updated_at: new Date().toISOString() }).eq("id", conversationId);
        if (titleError) throw titleError;
        return res.status(201).json({ user_message: userMessage, assistant_message: assistantMessage, replayed: false });
      }

      let greyConversationId = conversation.grey_conversation_id;
      // The first Grey request must always be replayed with the same payload:
      // its original request omitted conversation_id because Grey created it.
      let isOriginalInitializationMessage =
        conversation.grey_initialization_message_id === userMessage.id;
      let grey;

      if (!greyConversationId) {
        const { data: claim, error: claimError } = await greyState.rpc("businessflow_claim_grey_initialization", {
          p_conversation_id: conversationId,
          p_message_id: userMessage.id,
          p_user_id: req.user.id
        });
        if (claimError) throw claimError;
        if (claim?.status === "busy") {
          throw new GreyIntegrationError("Another request is initializing Grey for this conversation. Retry shortly.", 503, true);
        }

        if (claim?.status === "claimed") {
          if (!isUuid(claim.token) || !isUuid(claim.message_id)) {
            throw new GreyIntegrationError("Grey initialization state is invalid.", 502);
          }

          // If an earlier first-turn request timed out, recover that exact
          // message and request ID before processing the current turn.
          if (claim.message_id !== userMessage.id) {
            const { data: firstMessage, error: firstMessageError } = await req.supabase
              .from("businessflow_messages")
              .select("id,content,client_message_id,workspace_context")
              .eq("id", claim.message_id)
              .eq("conversation_id", conversationId)
              .eq("role", "user")
              .maybeSingle();
            if (firstMessageError) throw firstMessageError;
            if (!firstMessage || !isUuid(firstMessage.client_message_id) ||
                !firstMessage.workspace_context || typeof firstMessage.workspace_context !== "object") {
              throw new GreyIntegrationError("The original Grey initialization message cannot be recovered.", 503, true);
            }

            const recovered = await sendMessageToGrey({
              userId: req.user.id,
              businessId: conversation.business_id,
              message: firstMessage.content,
              requestId: firstMessage.client_message_id,
              conversationId: undefined,
              workspaceContext: firstMessage.workspace_context
            });
            const { data: completed, error: completeError } = await greyState.rpc("businessflow_complete_grey_initialization", {
              p_conversation_id: conversationId,
              p_token: claim.token,
              p_grey_conversation_id: recovered.conversationId,
              p_user_id: req.user.id
            });
            if (completeError) throw completeError;
            if (completed !== true) {
              throw new GreyIntegrationError("Grey conversation recovery could not be committed. Retry shortly.", 503, true);
            }
            greyConversationId = recovered.conversationId;
          } else {
            grey = await sendMessageToGrey({
              userId: req.user.id,
              businessId: conversation.business_id,
              message: userMessage.content,
              requestId: clientMessageId,
              conversationId: undefined,
              workspaceContext
            });
            const { data: completed, error: completeError } = await greyState.rpc("businessflow_complete_grey_initialization", {
              p_conversation_id: conversationId,
              p_token: claim.token,
              p_grey_conversation_id: grey.conversationId,
              p_user_id: req.user.id
            });
            if (completeError) throw completeError;
            if (completed !== true) {
              throw new GreyIntegrationError("Grey conversation initialization could not be committed. Retry shortly.", 503, true);
            }
            greyConversationId = grey.conversationId;
          }
        } else if (claim?.status === "ready" && isUuid(claim.conversation_id)) {
          greyConversationId = claim.conversation_id;
          isOriginalInitializationMessage = claim.message_id === userMessage.id;
        } else {
          throw new GreyIntegrationError("Grey conversation initialization returned an invalid state.", 502);
        }
      }

      // If we recovered a previous first turn, now process this turn against
      // the recovered Grey conversation using this turn's own idempotency key.
      if (!grey) {
        grey = await sendMessageToGrey({
          userId: req.user.id,
          businessId: conversation.business_id,
          message: userMessage.content,
          requestId: clientMessageId,
          conversationId: isOriginalInitializationMessage ? undefined : greyConversationId,
          workspaceContext
        });
      }

      const { data: assistantMessage, error: assistantError } = await req.supabase.rpc("businessflow_append_assistant_message", {
        p_conversation_id: conversationId,
        p_reply_to_message_id: userMessage.id,
        p_content: grey.response,
        p_assistant_mode: userMessage.assistant_mode ?? "grey"
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


function buildDatasetAnalysisReply(context) {
  const analysis = context.analysis || {};
  const coverage = analysis.coverage || {};
  const metrics = analysis.metrics || {};
  const business = context.profile || {};
  const currency = metrics.revenueCurrency || business.currency_code || "XOF";
  const lines = [
    "Here is the evidence-based analysis of " + (business.name || "your business") + ".",
    "",
    "DATA COVERAGE",
    Number(coverage.recordsAnalysed || 0).toLocaleString() + " imported records across " +
      Number(coverage.datasetCount || 0).toLocaleString() + " dataset(s). This is an imported snapshot, not a live feed."
  ];
  lines.push("", "BUSINESS OBJECTIVE",
    business.primary_goal
      ? String(business.primary_goal) + " (the onboarding objective; this is separate from a saved, tracked goal)."
      : "No primary business objective has been recorded.");
  lines.push("", "SAVED GOALS",
    Number(coverage.goalsCount || 0).toLocaleString() + " saved goal(s), including " +
    Number(coverage.activeGoalsCount || 0).toLocaleString() + " active goal(s).");

  if (metrics.revenueTotal !== null && metrics.revenueTotal !== undefined) {
    lines.push("", "REVENUE", Number(metrics.revenueTotal).toLocaleString("en-US", { maximumFractionDigits: 2 }) +
      " " + currency + " across " + Number(metrics.revenueRecords || 0).toLocaleString() + " readable revenue records.");
    if (metrics.averageOrderValue !== null && metrics.averageOrderValue !== undefined) {
      lines.push("Average recorded revenue per row: " + Number(metrics.averageOrderValue).toLocaleString("en-US", { maximumFractionDigits: 2 }) + " " + currency + ".");
    }
  } else {
    lines.push("", "REVENUE", "No verified revenue total is available because a revenue field is not mapped or contains no readable values.");
  }
  lines.push("", "CUSTOMERS", metrics.customers === null || metrics.customers === undefined
    ? "Customer count is unavailable because no customer identifier is mapped."
    : Number(metrics.customers).toLocaleString() + " distinct customers; " + Number(metrics.repeatCustomers || 0).toLocaleString() + " appear more than once.");
  lines.push("", "SERVICE MIX", metrics.topProduct
    ? metrics.topProduct.name + " is the most frequent mapped service/product (" + metrics.topProduct.records + " records)."
    : "No leading service can be identified reliably. Check that the mapped field contains a service category rather than a unique job or invoice code.");
  if (analysis.dataQuality && Array.isArray(analysis.dataQuality.notes) && analysis.dataQuality.notes.length) {
    lines.push("", "DATA QUALITY");
    for (const note of analysis.dataQuality.notes) lines.push("• " + note);
  }
  const findings = (analysis.insights || []).filter(item => item.type !== "coverage");
  if (findings.length) {
    lines.push("", "FINDINGS");
    for (const item of findings.slice(0, 7)) {
      lines.push("• " + item.title + ": " + item.summary);
      if (item.recommendedAction) lines.push("  Next step: " + item.recommendedAction);
    }
  }
  lines.push("", "LIMITATIONS", "These results describe imported records only. They do not establish profit, cash collected, conversion rate, or current live performance unless those fields are present and correctly mapped. Verify column mappings before making financial decisions.");
  return lines.join("\n");
}

async function buildWorkspaceContext(supabase, businessId) {
  const [profileResult, goalsResult, experimentsResult, memoryResult, importsResult, activityResult] = await Promise.all([
    supabase.from("businessflow_profiles").select("id,name,primary_goal,business_description,currency_code").eq("id", businessId).maybeSingle(),
    supabase.from("businessflow_goals").select("title,status,current_value,target_value,metric_name").eq("business_id", businessId).limit(30),
    supabase.from("businessflow_experiments").select("title,status,success_metric,result_summary").eq("business_id", businessId).limit(20),
    supabase.from("businessflow_memory").select("category,content").eq("business_id", businessId).order("created_at", { ascending: false }).limit(12),
    supabase.from("businessflow_imports").select("id,name,source_filename,columns,column_mapping,rows,row_count,created_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(10),
    supabase.from("businessflow_activity").select("event_type,title,message,created_at").eq("business_id", businessId).order("created_at", { ascending: false }).limit(12)
  ]);
  for (const result of [profileResult, goalsResult, experimentsResult, memoryResult, importsResult, activityResult]) {
    if (result.error) throw result.error;
  }
  if (!profileResult.data) throw new GreyIntegrationError("Business workspace not found.", 404);

  const context = {
    source: "BusinessFlow workspace records",
    profile: profileResult.data,
    analysis: buildBusinessInsights({
      profile: { id: businessId, ...profileResult.data },
      imports: importsResult.data ?? [],
      goals: goalsResult.data ?? [],
      experiments: experimentsResult.data ?? [],
      memory: memoryResult.data ?? []
    }),
    goals: goalsResult.data ?? [],
    experiments: experimentsResult.data ?? [],
    importedDatasets: (importsResult.data ?? []).map(item => ({
      name: item.name, sourceFilename: item.source_filename,
      columns: (item.columns ?? []).slice(0, 30),
      columnMapping: item.column_mapping ?? {}, rowCount: item.row_count,
      importedAt: item.created_at
    })),
    recentActivity: (activityResult.data ?? []).map(item => ({
      type: item.event_type, title: item.title, message: item.message, occurredAt: item.created_at
    })),
    memory: (memoryResult.data ?? []).map(item => ({
      category: item.category,
      content: (typeof item.content === "string" ? item.content : JSON.stringify(item.content)).slice(0, 700)
    }))
  };

  while (Buffer.byteLength(JSON.stringify(context), "utf8") > 9_000) {
    if (context.memory.length) context.memory.pop();
    else if (context.recentActivity.length) context.recentActivity.pop();
    else if (context.importedDatasets.length) context.importedDatasets.pop();
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
