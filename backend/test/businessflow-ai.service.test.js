import test from "node:test";
import assert from "node:assert/strict";
import { classifyBusinessIntent, reasonAboutBusiness, formatBusinessFlowAiReply } from "../src/modules/business-intelligence/businessflow-ai.service.js";

const profile = { id:"business-1", name:"Test shop", currency_code:"XOF", primary_goal:"Increase repeat customers" };

test("classifies common business questions deterministically", () => {
  assert.equal(classifyBusinessIntent("How can I increase revenue?"),"revenue");
  assert.equal(classifyBusinessIntent("How many repeat customers do we have?"),"customers");
  assert.equal(classifyBusinessIntent("Review my experiment"),"experiments");
  assert.equal(classifyBusinessIntent("What should I do next?"),"general");
});

test("does not invent revenue when no mapped data exists", () => {
  const result = reasonAboutBusiness({prompt:"How much revenue did we make?",profile,insights:{metrics:{revenueTotal:null,revenueRecords:0,revenueCurrency:"XOF"},coverage:{recordsAnalysed:0,activeGoalsCount:0,activeExperimentsCount:0}}});
  assert.equal(result.engine,"businessflow_ai_rules_v1");
  assert.ok(result.evidence.some(item=>item.includes("No verified revenue total")));
  assert.ok(result.limitations.some(item=>item.includes("No imported dataset")));
  assert.ok(formatBusinessFlowAiReply(result).includes("Recommended next steps"));
});

test("uses only supplied workspace metrics for customer reasoning", () => {
  const result = reasonAboutBusiness({prompt:"Tell me about customers",profile,insights:{metrics:{customers:12,repeatCustomers:4},coverage:{recordsAnalysed:20,activeGoalsCount:1,activeExperimentsCount:2}}});
  assert.ok(result.evidence.some(item=>item.includes("12 distinct customers")));
  assert.ok(result.recommendedActions.length > 0);
});
