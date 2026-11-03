import test from "node:test";
import assert from "node:assert/strict";
import { buildBusinessInsights } from "./business-intelligence.analytics.js";

const profile = { id: "business-1", name: "Test business", currency_code: "XOF" };

function analyse(rows) {
  return buildBusinessInsights({
    profile,
    imports: [{
      id: "dataset-1",
      name: "Sales",
      row_count: rows.length,
      column_mapping: {
        customer: "customer_id",
        date: "order_date",
        item: "product",
        sales: "revenue",
        expense: "cost"
      },
      rows
    }]
  });
}

test("monthly retention compares only the immediately previous calendar month", () => {
  const result = analyse([
    { customer: "customer-a", date: "2026-01-10", item: "Service A", sales: "100", expense: "40" },
    { customer: "customer-a", date: "2026-03-10", item: "Service A", sales: "120", expense: "50" },
    { customer: "customer-b", date: "2026-03-11", item: "Service B", sales: "80", expense: "30" }
  ]);

  assert.deepEqual(result.metrics.monthlyRetention, [
    { month: "2026-01", activeCustomers: 1, returningCustomers: 0, returningRate: 0 },
    { month: "2026-03", activeCustomers: 2, returningCustomers: 0, returningRate: 0 }
  ]);
});

test("gross profit uses only records with both valid revenue and cost", () => {
  const result = analyse([
    { customer: "customer-a", date: "2026-01-10", item: "Service A", sales: "100", expense: "40" },
    { customer: "customer-b", date: "2026-01-11", item: "Service A", sales: "200", expense: "" },
    { customer: "customer-c", date: "2026-01-12", item: "Service B", sales: "80", expense: "30" }
  ]);

  assert.equal(result.metrics.profitabilityRecords, 2);
  assert.equal(result.metrics.profitabilityRevenue, 180);
  assert.equal(result.metrics.profitabilityCost, 70);
  assert.equal(result.metrics.grossProfit, 110);
  assert.equal(result.metrics.grossMarginPercent, 61.1);
});

test("product profitability exposes comparable record coverage", () => {
  const result = analyse([
    { customer: "customer-a", date: "2026-01-10", item: "Service A", sales: "100", expense: "40" },
    { customer: "customer-b", date: "2026-01-11", item: "Service A", sales: "200", expense: "" },
    { customer: "customer-c", date: "2026-01-12", item: "Service B", sales: "80", expense: "30" }
  ]);

  const serviceA = result.metrics.productPerformance.find(item => item.name === "Service A");
  assert.equal(serviceA.records, 2);
  assert.equal(serviceA.revenue, 300);
  assert.equal(serviceA.cost, 40);
  assert.equal(serviceA.grossProfit, 60);
  assert.equal(serviceA.comparableRecords, 1);
});
