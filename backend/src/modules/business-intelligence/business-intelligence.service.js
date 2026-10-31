const ONBOARDING_QUESTIONS = Object.freeze([
  {
    id: "business_basics",
    title: "Tell us about your business",
    prompt: "What does your business sell or provide, and who do you serve?",
    purpose: "Understand the business model and intended customers.",
    required: true
  },
  {
    id: "primary_goal",
    title: "Choose your main goal",
    prompt: "What is the most important result you want to improve first?",
    purpose: "Establish one measurable priority before recommending actions.",
    required: true
  },
  {
    id: "current_baseline",
    title: "Where are you today?",
    prompt: "What do you currently know about revenue, customers, or conversions?",
    purpose: "Record a baseline and distinguish measured data from estimates.",
    required: false
  },
  {
    id: "constraints",
    title: "What should we work within?",
    prompt: "Are there budget, time, staffing, or location constraints to respect?",
    purpose: "Keep recommendations realistic and within the business owner's limits.",
    required: false
  },
  {
    id: "success_measure",
    title: "How will we measure progress?",
    prompt: "What number or observable change would tell you this is working?",
    purpose: "Define a measurable success signal for future experiments.",
    required: false
  }
]);

/**
 * Return a copy so callers cannot mutate the module's canonical question list.
 * This is deterministic onboarding guidance, not an AI-generated response.
 */
export function getOnboardingQuestions() {
  return ONBOARDING_QUESTIONS.map(question => ({ ...question }));
}

/**
 * Validate and normalize an onboarding answer payload before the authenticated route persists it.
 * Tenant identity must come from verified authentication middleware, never from the
 * request body. This function intentionally does not write to a database.
 */
export function validateOnboardingAnswers(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      valid: false,
      errors: ["Answers must be provided as a JSON object."]
    };
  }

  const allowedIds = new Set(ONBOARDING_QUESTIONS.map(question => question.id));
  const errors = [];
  const answers = {};

  for (const [key, value] of Object.entries(input)) {
    if (!allowedIds.has(key)) {
      errors.push(`Unknown onboarding field: ${key}.`);
      continue;
    }

    if (typeof value !== "string") {
      errors.push(`Answer for ${key} must be text.`);
      continue;
    }

    const normalized = value.trim();

    if (normalized.length > 2000) {
      errors.push(`Answer for ${key} must be 2000 characters or fewer.`);
      continue;
    }

    answers[key] = normalized;
  }

  for (const question of ONBOARDING_QUESTIONS) {
    if (question.required && !answers[question.id]) {
      errors.push(`Answer required for ${question.id}.`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    ...(errors.length === 0 ? { answers } : {})
  };
}
