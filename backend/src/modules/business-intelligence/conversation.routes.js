import { Router } from "express";
import { requireAuthenticatedUser } from "../../middleware/require-authenticated-user.js";
import { askOyoSky, OyoSkyClientError } from "./oyosky.client.js";
import { askGrey, GreyClientError } from "./grey.client.js";

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
    const assistantMode = req.body?.assistant_mode ?? "businessflow";
    if (!["businessflow", "oyosky", "grey"].includes(assistantMode)) {
      return res.status(400).json({ error: "invalid_assistant_mode" });
    }
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

    if (!userMessage || userMessage.content !== content.trim()) {
      return res.status(409).json({
        error: "client_message_id_conflict",
        message: "This message ID was already used for different content. Start a new send attempt."
      });
    }

    const { data: existingReply, error: replyLookupError } = await req.supabase.from("businessflow_messages")
      .select("id,conversation_id,role,content,created_at")
      .eq("reply_to_message_id", userMessage.id).maybeSingle();
    if (replyLookupError) return next(replyLookupError);
    if (existingReply) return res.json({ user_message: userMessage, assistant_message: existingReply, replayed: true });

    let answer;
    let greyConversationId = null;
    try {
      if (assistantMode === "oyosky") {
        answer = await buildOyoSkyReply(req.supabase, conversation.business_id, userMessage.content);
      } else if (assistantMode === "grey") {
        const workspaceContext = await buildGreyWorkspaceContext(req.supabase, conversation.business_id);
        const greyResult = await askGrey({
          message: userMessage.content,
          userId: req.user.id,
          businessId: conversation.business_id,
          conversationId: conversation.grey_conversation_id ?? null,
          workspaceContext
        });
        answer = greyResult.content;
        greyConversationId = greyResult.conversationId;
      } else {
        answer = await buildBusinessFlowReply(req.supabase, conversation.business_id, userMessage.content);
      }
    } catch (error) {
      if (error instanceof GreyClientError) {
        return res.status(503).json({
          error: error.code,
          message: error.message,
          user_message_saved: true,
          retryable: true
        });
      }
      if (error instanceof OyoSkyClientError) {
        return res.status(503).json({
          error: error.code,
          message: error.message,
          user_message_saved: true,
          retryable: true
        });
      }
      return next(error);
    }
    const { data: assistantMessage, error: assistantError } = await req.supabase.rpc("businessflow_append_assistant_message", {
      p_conversation_id: conversationId,
      p_reply_to_message_id: userMessage.id,
      p_content: answer
    });
    if (assistantError) return next(assistantError);

    if (greyConversationId && greyConversationId !== conversation.grey_conversation_id) {
      const { error: linkError } = await req.supabase.from("businessflow_conversations")
        .update({ grey_conversation_id: greyConversationId })
        .eq("id", conversationId).eq("business_id", conversation.business_id);
      if (linkError) return next(linkError);
    }

    const nextTitle = conversation.title === "New conversation" ? userMessage.content.slice(0, 80) : conversation.title;
    await req.supabase.from("businessflow_conversations").update({ title: nextTitle, updated_at: new Date().toISOString() }).eq("id", conversationId);
    return res.status(201).json({ user_message: userMessage, assistant_message: assistantMessage, replayed: false });
  } catch (error) { return next(error); }
});

async function loadBusinessWorkspaceContext(supabase, businessId) {
  const [profileResult, goalsResult, experimentsResult, memoryResult] = await Promise.all([
    supabase.from("businessflow_profiles").select("name,primary_goal,business_description,currency_code").eq("id", businessId).maybeSingle(),
    supabase.from("businessflow_goals").select("title,status,current_value,target_value,metric_name").eq("business_id", businessId).limit(50),
    supabase.from("businessflow_experiments").select("title,status,success_metric,result_summary").eq("business_id", businessId).limit(50),
    supabase.from("businessflow_memory").select("category,content").eq("business_id", businessId).order("created_at", { ascending: false }).limit(20)
  ]);
  for (const result of [profileResult, goalsResult, experimentsResult, memoryResult]) {
    if (result.error) throw result.error;
  }
  if (!profileResult.data) throw new Error("Business workspace not found.");
  return {
    profile: profileResult.data,
    goals: goalsResult.data ?? [],
    experiments: experimentsResult.data ?? [],
    memory: memoryResult.data ?? []
  };
}

async function buildGreyWorkspaceContext(supabase, businessId) {
  const { profile, goals, experiments, memory } = await loadBusinessWorkspaceContext(supabase, businessId);
  return {
    business: {
      name: String(profile.name || "").slice(0, 160),
      description: String(profile.business_description || "").slice(0, 1000),
      primary_goal: String(profile.primary_goal || "").slice(0, 300),
      currency_code: String(profile.currency_code || "").slice(0, 8)
    },
    goals: goals.slice(0, 15).map(item => ({
      title: String(item.title || "").slice(0, 120),
      status: item.status,
      current_value: item.current_value,
      target_value: item.target_value,
      metric_name: String(item.metric_name || "").slice(0, 60)
    })),
    experiments: experiments.slice(0, 10).map(item => ({
      title: String(item.title || "").slice(0, 120),
      status: item.status,
      success_metric: String(item.success_metric || "").slice(0, 180),
      result_summary: String(item.result_summary || "").slice(0, 200)
    })),
    business_memory: memory.slice(0, 5).map(item => ({
      category: String(item.category || "other").slice(0, 40),
      content: String(typeof item.content === "string" ? item.content : JSON.stringify(item.content)).slice(0, 200)
    }))
  };
}

async function buildBusinessFlowReply(supabase, businessId, prompt) {
  const { profile, goals, experiments, memory } = await loadBusinessWorkspaceContext(supabase, businessId);
  const activeGoals = goals.filter(item => item.status === "active");
  const runningExperiments = experiments.filter(item => item.status === "running");
  const lower = prompt.toLowerCase();
  const lines = [
    "I'm BusinessFlow Intelligence for " + profile.name + ". I can use this workspace's saved business records to help you make evidence-based decisions.",
    profile.primary_goal ? "Your recorded primary goal: " + profile.primary_goal + "." : "Your primary goal has not been recorded yet.",
    "Workspace context: " + activeGoals.length + " active goal(s), " + runningExperiments.length + " running experiment(s), and " + memory.length + " saved memory item(s)."
  ];
  if (/goal|target|progress|revenue|customer|growth|sales|performance/.test(lower) && activeGoals.length) {
    lines.push("Active goals:");
    for (const goal of activeGoals.slice(0, 5)) {
      const progress = typeof goal.target_value === "number" && goal.target_value > 0
        ? " (" + Math.round((Number(goal.current_value || 0) / goal.target_value) * 100) + "% of target)"
        : "";
      lines.push("• " + goal.title + ": " + (goal.current_value ?? 0) + (goal.metric_name ? " " + goal.metric_name : "") +
        (goal.target_value !== null ? " / " + goal.target_value : "") + progress + ".");
    }
  }
  if (/experiment|test|campaign|marketing/.test(lower) && experiments.length) {
    lines.push("Recent experiments:");
    for (const experiment of experiments.slice(0, 5)) {
      lines.push("• " + experiment.title + " (" + experiment.status + ")" +
        (experiment.success_metric ? ": " + experiment.success_metric : "") + ".");
    }
  }
  if (memory.length) {
    lines.push("Relevant saved business memory:");
    for (const item of memory.slice(0, 3)) {
      const value = typeof item.content === "string" ? item.content : JSON.stringify(item.content);
      lines.push("• " + String(value).slice(0, 350));
    }
  }
  lines.push("What I can do right now: review your goals, interpret imported datasets through the Analytics page, and help structure an experiment. This mode uses saved workspace data and deterministic rules. It does not use a trained language model or execute actions. I won't invent figures when the workspace has no supporting data.");
  return lines.join("\n").slice(0, 7900);
}

async function buildOyoSkyReply(supabase, businessId, prompt) {
  const { profile, goals, experiments, memory } = await loadBusinessWorkspaceContext(supabase, businessId);
  const context = {
    business: {
      name: String(profile.name || "").slice(0, 160),
      description: String(profile.business_description || "").slice(0, 1500),
      primary_goal: String(profile.primary_goal || "").slice(0, 500),
      currency_code: String(profile.currency_code || "").slice(0, 8)
    },
    goals: goals.slice(0, 20).map(item => ({
      title: String(item.title || "").slice(0, 160),
      status: item.status,
      current_value: item.current_value,
      target_value: item.target_value,
      metric_name: String(item.metric_name || "").slice(0, 80)
    })),
    experiments: experiments.slice(0, 15).map(item => ({
      title: String(item.title || "").slice(0, 160),
      status: item.status,
      success_metric: String(item.success_metric || "").slice(0, 250),
      result_summary: String(item.result_summary || "").slice(0, 350)
    })),
    business_memory: memory.slice(0, 10).map(item => ({
      category: String(item.category || "other").slice(0, 50),
      content: String(typeof item.content === "string" ? item.content : JSON.stringify(item.content)).slice(0, 300)
    }))
  };
  return askOyoSky(prompt, context);
}
