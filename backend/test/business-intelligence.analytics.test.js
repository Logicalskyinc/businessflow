import test from "node:test";
import assert from "node:assert/strict";
import { buildBusinessInsights, filterImportsToPeriod } from "../src/modules/business-intelligence/business-intelligence.analytics.js";

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


test("uses the explicit source currency suffix instead of relabelling USD amounts as workspace currency", () => {
  const result = buildBusinessInsights({
    profile: { ...profile, currency_code: "XOF" },
    imports: [{ id: "currency-1", name: "USD sales", row_count: 1,
      column_mapping: { Total_Amount_USD: "revenue", Service_Date: "order_date" },
      rows: [{ Total_Amount_USD: "125.50", Service_Date: "2026-10-01" }] }]
  });
  assert.equal(result.metrics.revenueTotal, 125.5);
  assert.equal(result.metrics.revenueCurrency, "USD");
  assert.equal(result.metrics.revenueCurrencyFromColumn, true);
  assert.ok(result.dataQuality.notes.some(note => note.includes("workspace currency is XOF")));
  assert.equal(result.metrics.monthlyRevenue[0].total, 125.5);
});

test("does not call a unique job code the most frequent service", () => {
  const result = buildBusinessInsights({
    profile,
    imports: [{ id: "i3", name: "Jobs", row_count: 3,
      column_mapping: { "Job code": "product" },
      rows: [
        { "Job code": "ABC-JOB-001" },
        { "Job code": "ABC-JOB-002" },
        { "Job code": "ABC-JOB-003" }
      ] }]
  });
  assert.equal(result.metrics.topProduct, null);
  const finding = result.insights.find(item => item.type === "product_mix");
  assert.ok(finding);
  assert.match(finding.summary, /does not support naming a most frequent service/);
});


test("filters imported records to the selected reporting period and counts invalid dates", () => {
  const source = [{
    id: "period-1", name: "Orders", row_count: 5,
    column_mapping: { Amount: "revenue", Customer: "customer_name", Date: "order_date" },
    rows: [
      { Amount: "100", Customer: "A", Date: "2026-10-01" },
      { Amount: "200", Customer: "B", Date: "2026-10-15" },
      { Amount: "300", Customer: "C", Date: "2026-11-01" },
      { Amount: "400", Customer: "D", Date: "not-a-date" },
      { Amount: "500", Customer: "E", Date: "" }
    ]
  }];
  const result = filterImportsToPeriod(source, {
    start: "2026-10-10T00:00:00.000Z",
    end: "2026-10-31T23:59:59.999Z"
  });
  assert.equal(result.imports[0].rows.length, 1);
  assert.equal(result.imports[0].rows[0].Amount, "200");
  assert.equal(result.excludedUndatedRecords, 2);
  assert.equal(source[0].rows.length, 5, "filter must not mutate the source dataset");
});

test("excludes every record in datasets without a mapped order date", () => {
  const result = filterImportsToPeriod([{
    id: "undated", row_count: 2, column_mapping: {}, rows: [{ Amount: "10" }, { Amount: "20" }]
  }], {
    start: "2026-10-01T00:00:00.000Z",
    end: "2026-10-31T23:59:59.999Z"
  });
  assert.deepEqual(result.imports[0].rows, []);
  assert.equal(result.excludedUndatedRecords, 2);
});

test("rejects invalid reporting period boundaries", () => {
  assert.throws(() => filterImportsToPeriod([], {
    start: "invalid", end: "2026-10-31T23:59:59.999Z"
  }), /valid reporting period/);
  assert.throws(() => filterImportsToPeriod([], {
    start: "2026-11-01T00:00:00.000Z", end: "2026-10-01T00:00:00.000Z"
  }), /valid reporting period/);
});

test("warns when multiple imported datasets may contain overlapping records", () => {
  const result = buildBusinessInsights({
    profile,
    imports: [
      { id: "one", name: "October snapshot", row_count: 1, column_mapping: { Amount: "revenue" }, rows: [{ Amount: "100" }] },
      { id: "two", name: "November snapshot", row_count: 1, column_mapping: { Amount: "revenue" }, rows: [{ Amount: "100" }] }
    ]
  });
  assert.ok(result.dataQuality.notes.some(note => note.includes("overlapping snapshots or transactions")));
});
