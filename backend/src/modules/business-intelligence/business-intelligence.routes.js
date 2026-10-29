import { Router } from "express";
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
      persistentBusinessMemory: false,
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

  // Validation only: do not store business data until authenticated tenant
  // identity, database schema, and row-level access controls are implemented.
  return response.status(200).json({
    status: "valid",
    message: "Answers passed validation. Nothing has been saved yet.",
    answers: result.answers
  });
});
