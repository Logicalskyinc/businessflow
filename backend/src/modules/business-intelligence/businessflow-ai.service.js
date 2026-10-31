const INTENTS = [
  { id:"revenue", terms:/revenue|sales|income|money|turnover|profit|price|payment/ },
  { id:"customers", terms:/customer|client|retention|repeat|buyer|audience/ },
  { id:"experiments", terms:/experiment|test|hypothesis|campaign|marketing|offer/ },
  { id:"goals", terms:/goal|target|progress|priority|objective/ },
  { id:"operations", terms:/operation|process|staff|time|delivery|service|stock|inventory/ }
];

const number = value => Number.isFinite(Number(value)) ? Number(value) : null;

export function classifyBusinessIntent(prompt) {
  const text = String(prompt || "").toLowerCase();
  return INTENTS.find(intent => intent.terms.test(text))?.id || "general";
}

export function reasonAboutBusiness({ prompt, profile, insights }) {
  const intent = classifyBusinessIntent(prompt);
  const metrics = insights?.metrics || {};
  const coverage = insights?.coverage || {};
  const records = Number(coverage.recordsAnalysed || 0);
  const currency = metrics.revenueCurrency || profile?.currency_code || "XOF";
  const evidence = [];
  const actions = [];

  if (intent === "revenue") {
    if (number(metrics.revenueTotal) !== null) {
      evidence.push("Imported records contain " + metrics.revenueRecords + " readable revenue values totalling " +
        Number(metrics.revenueTotal).toLocaleString("en-US") + " " + currency + ".");
      actions.push("Compare this total with the previous period using datasets with the same date range.");
      actions.push("Review blank or invalid amount cells before using the total for financial decisions.");
    } else {
      evidence.push("No verified revenue total is available because revenue is missing or has not been mapped.");
      actions.push("Import sales or transaction records and map the amount column to Revenue.");
      actions.push("Confirm whether amounts represent gross sales, net sales, or payments received.");
    }
  } else if (intent === "customers") {
    if (number(metrics.customers) !== null) {
      evidence.push(metrics.customers + " distinct customers were identified; " + (metrics.repeatCustomers ?? 0) + " appeared more than once.");
      actions.push("Compare repeat-customer frequency by month or service.");
      actions.push("Review the customer identifier mapping so the same person is not counted under different names.");
    } else {
      evidence.push("Customer identity is not mapped, so distinct and repeat customers cannot be measured.");
      actions.push("Import a stable customer ID, email, or customer-name column and map it.");
    }
  } else if (intent === "experiments") {
    evidence.push((coverage.activeExperimentsCount || 0) + " planned or running experiments are recorded in this workspace.");
    actions.push("Give each experiment one measurable success metric and a baseline.");
    actions.push("Record the result when the test ends, then compare it with the baseline.");
  } else if (intent === "goals") {
    evidence.push((coverage.activeGoalsCount || 0) + " active goals are recorded in this workspace.");
    actions.push("Keep each goal measurable with a current value, target, and review date.");
    actions.push("Update progress from verified business records rather than estimates.");
  } else if (intent === "operations") {
    evidence.push(records + " imported business records are available for analysis.");
    actions.push("Choose one operational measure, such as delivery time, completed jobs, or stock availability.");
    actions.push("Import consistent dated records before comparing operational performance.");
  } else {
    evidence.push(records + " imported records, " + (coverage.activeGoalsCount || 0) + " active goals, and " +
      (coverage.activeExperimentsCount || 0) + " active experiments are available in this workspace.");
    actions.push("Start with one business outcome and identify the records that can measure it.");
    actions.push("Use a small experiment to test one change before committing more budget or time.");
  }

  if (records === 0) {
    evidence.push("No imported dataset is available yet. This response will not invent sales or customer figures.");
  }
  const goal = profile?.primary_goal ? "Your recorded priority is: " + profile.primary_goal + "." : "Your workspace has no recorded primary goal yet.";
  return {
    status:"ok",
    engine:"businessflow_ai_rules_v1",
    provider:"first_party_deterministic",
    intent,
    business: { id:profile?.id, name:profile?.name },
    summary: goal,
    evidence,
    recommendedActions: actions,
    limitations: records === 0 ? ["No imported dataset is available. Recommendations are based only on workspace setup and saved records."] : ["This version uses transparent deterministic rules, not a trained language model."],
    nextQuestion: intent === "general" ? "Which result matters most right now: revenue, customer growth, or operational efficiency?" : "What time period or target should we use to measure progress?"
  };
}

export function formatBusinessFlowAiReply(result) {
  return [
    "BusinessFlow AI · " + result.business.name,
    result.summary,
    "",
    "What the workspace data shows:",
    ...result.evidence.map(item => "• " + item),
    "",
    "Recommended next steps:",
    ...result.recommendedActions.map((item,index) => (index+1) + ". " + item),
    "",
    "Limitations: " + result.limitations.join(" ")
  ].join("\n").slice(0,7900);
}
