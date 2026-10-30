import test from "node:test";
import assert from "node:assert/strict";
import { buildBusinessInsights } from "../src/modules/business-intelligence/business-intelligence.analytics.js";

const profile = { id: "business-1", name: "AB Cleaning Services", currency_code: "XOF" };

test("calculates metrics from mapped imported records", () => {
  const result = buildBusinessInsights({
    profile,
    imports: [{ id: "import-1", name: "Sales", source_filename: "sales.csv", row_count: 3,
      column_mapping: { Amount: "revenue", Customer: "customer_name", Service: "product", Date: "order_date" },
      rows: [
        { Amount: "10000", Customer: "Amina", Service: "Deep clean", Date: "2026-10-01" },
        { Amount: "15000", Customer: "Amina", Service: "Deep clean", Date: "2026-10-02" },
        { Amount: "5000", Customer: "Kofi", Service: "Standard clean", Date: "2026-10-03" }
      ] }],
    goals: [{ id: "g1", title: "Grow revenue", status: "active", current_value: 50, target_value: 100, metric_name: "orders" }],
    experiments: [{ title: "Test follow-up", status: "running" }], memory: [{ id: "m1" }]
  });
  assert.equal(result.engine, "businessflow_rules_v1");
  assert.equal(result.metrics.revenueTotal, 30000);
  assert.equal(result.metrics.customers, 2);
  assert.equal(result.metrics.repeatCustomers, 1);
  assert.equal(result.metrics.averageOrderValue, 10000);
  assert.equal(result.goals[0].progressPercent, 50);
  assert.equal(result.coverage.recordsAnalysed, 3);
  assert.ok(result.insights.some(item => item.type === "revenue"));
});

test("does not invent revenue or customer metrics when fields are unmapped", () => {
  const result = buildBusinessInsights({ profile, imports: [{ id: "i1", name: "Notes", row_count: 1, column_mapping: {}, rows: [{ note: "hello" }] }] });
  assert.equal(result.metrics.revenueTotal, null);
  assert.equal(result.metrics.customers, null);
  assert.ok(result.dataQuality.notes.includes("Revenue field is not mapped."));
});

test("profiles useful patterns in unmapped columns without treating them as business metrics", () => {
  const result = buildBusinessInsights({
    profile,
    imports: [{ id: "i2", name: "Operations", row_count: 4,
      columns: ["Amount paid", "Job type", "Zone"],
      column_mapping: {},
      rows: [
        { "Amount paid": "12000", "Job type": "Deep clean", Zone: "East" },
        { "Amount paid": "18000", "Job type": "Deep clean", Zone: "West" },
        { "Amount paid": "9000", "Job type": "Standard", Zone: "East" },
        { "Amount paid": "15000", "Job type": "Standard", Zone: "East" }
      ] }]
  });
  const pattern = result.insights.find(item => item.type === "column_patterns");
  assert.ok(pattern);
  assert.match(pattern.summary, /Amount paid/);
  assert.match(pattern.summary, /Job type/);
  assert.equal(result.metrics.revenueTotal, null);
  assert.equal(result.metrics.customers, null);
});

test("reports missing data without fabricating metrics", () => {
  const result = buildBusinessInsights({ profile });
  assert.equal(result.coverage.recordsAnalysed, 0);
  assert.equal(result.metrics.revenueTotal, null);
  assert.equal(result.metrics.customers, null);
  assert.equal(result.insights[0].type, "data_needed");
});
