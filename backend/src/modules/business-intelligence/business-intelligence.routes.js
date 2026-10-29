import { Router } from "express";
import { requireAuthenticatedUser } from "../../middleware/require-authenticated-user.js";
import {
  getOnboardingQuestions,
  validateOnboardingAnswers
} from "./business-intelligence.service.js";

export const businessIntelligenceRouter = Router();

businessIntelligenceRouter.get("/health", (_request, response) => {
  response.status(200).json({
    module: "business-intelligence",
    status: "available",
    capabilities: {
      onboardingQuestions: true,
      answerValidation: true,
      persistentBusinessMemory: true,
      profilePersistence: true,
      liveBusinessAnalytics: false,
      aiReasoning: false,
      externalActions: false
    }
  });
});

businessIntelligenceRouter.get("/onboarding/questions", (_request, response) => {
  response.status(200).json({
    status: "ok",
    questions: getOnboardingQuestions()
  });
});

businessIntelligenceRouter.post("/onboarding/validate", (request, response) => {
  const result = validateOnboardingAnswers(request.body);

  if (!result.valid) {
    return response.status(400).json({
      status: "invalid",
      errors: result.errors
    });
  }

  return response.status(200).json({
    status: "valid",
    message: "Answers passed validation. Nothing has been saved by this endpoint.",
    answers: result.answers
  });
});

/**
 * Persist onboarding under the verified Supabase user.
 * The owner ID is derived from the verified access token, never from the body.
 * The request-scoped Supabase client forwards that token so database RLS applies.
 */
businessIntelligenceRouter.post("/onboarding", requireAuthenticatedUser, async (request, response, next) => {
  try {
    const body = request.body;

    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return response.status(400).json({
        status: "invalid",
        errors: ["Request body must be a JSON object."]
      });
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length < 1 || name.length > 160) {
      return response.status(400).json({
        status: "invalid",
        errors: ["Business name must contain 1 to 160 characters."]
      });
    }

    const result = validateOnboardingAnswers(body.answers);
    if (!result.valid) {
      return response.status(400).json({
        status: "invalid",
        errors: result.errors
      });
    }

    const { answers } = result;
    const { data, error } = await request.supabase
      .from("businessflow_profiles")
      .insert({
        owner_user_id: request.user.id,
        name,
        business_description: answers.business_basics,
        primary_goal: answers.primary_goal,
        onboarding_answers: answers
      })
      .select("id, name, business_type, business_description, primary_goal, onboarding_answers, country_code, currency_code, created_at, updated_at")
      .single();

    if (error) {
      if (error.code === "42501" || error.code === "PGRST301") {
        return response.status(403).json({
          error: "business_access_denied",
          message: "The authenticated account is not allowed to save this business."
        });
      }
      return next(error);
    }

    return response.status(201).json({
      status: "created",
      business: data
    });
  } catch (error) {
    return next(error);
  }
});

businessIntelligenceRouter.get("/businesses", requireAuthenticatedUser, async (request, response, next) => {
  try {
    const { data, error } = await request.supabase
      .from("businessflow_profiles")
      .select("id, name, business_type, primary_goal, country_code, currency_code, created_at, updated_at")
      .order("created_at", { ascending: false });

    if (error) {
      return next(error);
    }

    return response.status(200).json({
      status: "ok",
      businesses: data
    });
  } catch (error) {
    return next(error);
  }
});
