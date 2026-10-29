import test from "node:test";
import assert from "node:assert/strict";
import {
  getOnboardingQuestions,
  validateOnboardingAnswers
} from "../src/modules/business-intelligence/business-intelligence.service.js";

test("onboarding questions include required business basics and primary goal", () => {
  const questions = getOnboardingQuestions();
  const requiredIds = questions.filter(question => question.required).map(question => question.id);

  assert.deepEqual(requiredIds, ["business_basics", "primary_goal"]);
});

test("question results cannot mutate the canonical list", () => {
  const questions = getOnboardingQuestions();
  questions[0].prompt = "changed";

  assert.notEqual(getOnboardingQuestions()[0].prompt, "changed");
});

test("validates required answers and returns normalized text", () => {
  const result = validateOnboardingAnswers({
    business_basics: "  I sell shoes to local customers  ",
    primary_goal: "  Get more customers "
  });

  assert.equal(result.valid, true);
  assert.equal(result.answers.business_basics, "I sell shoes to local customers");
  assert.equal(result.answers.primary_goal, "Get more customers");
});

test("rejects missing required answers", () => {
  const result = validateOnboardingAnswers({ business_basics: "A shop" });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("primary_goal")));
});

test("rejects unknown fields and non-text answers", () => {
  const result = validateOnboardingAnswers({
    business_basics: "A shop",
    primary_goal: "More customers",
    tenant_id: "untrusted-tenant",
    constraints: 42
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("Unknown onboarding field")));
  assert.ok(result.errors.some(error => error.includes("must be text")));
});

test("rejects oversized answers", () => {
  const result = validateOnboardingAnswers({
    business_basics: "x".repeat(2001),
    primary_goal: "More customers"
  });

  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.includes("2000 characters")));
});
