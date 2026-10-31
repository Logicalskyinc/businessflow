const numericValue = value => {
  if (value === null || value === undefined || value === "") return null;
  const normalized = String(value).trim().replace(/[^0-9,.-]/g, "").replace(/,/g, "");
  if (!normalized || !/^-?\d+(?:\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
};
const uniqueText = value => String(value ?? "").trim().toLowerCase();

export function buildBusinessInsights({ profile, imports = [], goals = [], experiments = [], memory = [] }) {
  const rows = [], datasetNames = [], additionalColumnFindings = [];
  let revenueMapped = false, customerMapped = false, productMapped = false, dateMapped = false;
  let invalidRevenueValues = 0, revenueValueCount = 0, revenueTotal = 0;
  const customerIds = new Set(), customerFrequency = new Map(), productFrequency = new Map(), monthlyRevenue = new Map(), dateValues = [];
  for (const dataset of imports) {
    const mapping = dataset.column_mapping && typeof dataset.column_mapping === "object" ? dataset.column_mapping : {};
    const fields = {};
    for (const [column, field] of Object.entries(mapping)) if (field) fields[field] = column;
    revenueMapped ||= Boolean(fields.revenue);
    customerMapped ||= Boolean(fields.customer_id || fields.email || fields.customer_name);
    productMapped ||= Boolean(fields.product);
    dateMapped ||= Boolean(fields.order_date);
    datasetNames.push({ id: dataset.id, name: dataset.name, filename: dataset.source_filename, rowCount: dataset.row_count });
    const datasetRows = Array.isArray(dataset.rows) ? dataset.rows : [];
    const mappedColumns = new Set(Object.values(fields).filter(Boolean));
    const sourceColumns = Array.isArray(dataset.columns) && dataset.columns.length
      ? dataset.columns.map(column => typeof column === "string" ? column : column?.name).filter(Boolean)
      : [...new Set(datasetRows.flatMap(row => row && typeof row === "object" ? Object.keys(row) : []))];
    for (const column of sourceColumns) {
      if (mappedColumns.has(column)) continue;
      const values = datasetRows.map(row => String(row?.[column] ?? "").trim()).filter(Boolean);
      if (values.length < 2) continue;
      const numbers = values.map(numericValue);
      const validNumbers = numbers.filter(value => value !== null);
      if (validNumbers.length >= 2 && validNumbers.length / values.length >= 0.7) {
        const total = validNumbers.reduce((sum, value) => sum + value, 0);
        additionalColumnFindings.push({
          dataset: dataset.name, column, kind: "numeric",
          summary: validNumbers.length + " of " + values.length + " non-empty values are numeric; average " +
            (total / validNumbers.length).toLocaleString("en-US", { maximumFractionDigits: 2 }) +
            ", range " + Math.min(...validNumbers).toLocaleString("en-US", { maximumFractionDigits: 2 }) +
            " to " + Math.max(...validNumbers).toLocaleString("en-US", { maximumFractionDigits: 2 })
        });
        continue;
      }
      const frequencies = new Map();
      for (const value of values) frequencies.set(value, (frequencies.get(value) || 0) + 1);
      const common = [...frequencies.entries()].sort((left, right) => right[1] - left[1]).slice(0, 3);
      if (frequencies.size > 1) {
        additionalColumnFindings.push({
          dataset: dataset.name, column, kind: "category",
          summary: frequencies.size + " distinct values; most common: " +
            common.map(([value, count]) => value + " (" + count + ")").join(", ")
        });
      }
    }
    for (const sourceRow of datasetRows) {
      const row = sourceRow && typeof sourceRow === "object" ? sourceRow : {};
      rows.push(row);
      if (fields.revenue) {
        const amount = numericValue(row[fields.revenue]);
        if (amount === null) invalidRevenueValues++;
        else { revenueTotal += amount; revenueValueCount++; }
      }
      if (fields.customer_id || fields.email || fields.customer_name) {
        const customer = uniqueText(row[fields.customer_id] || row[fields.email] || row[fields.customer_name]);
        if (customer) { customerIds.add(customer); customerFrequency.set(customer, (customerFrequency.get(customer) || 0) + 1); }
      }
      if (fields.product) {
        const product = String(row[fields.product] ?? "").trim();
        if (product) productFrequency.set(product, (productFrequency.get(product) || 0) + 1);
      }
      if (fields.order_date) {
        const parsed = new Date(String(row[fields.order_date] ?? "").trim());
        if (!Number.isNaN(parsed.getTime())) {
          dateValues.push(parsed.toISOString());
          if (fields.revenue) {
            const amount = numericValue(row[fields.revenue]);
            if (amount !== null) { const month = parsed.toISOString().slice(0, 7); monthlyRevenue.set(month, (monthlyRevenue.get(month) || 0) + amount); }
          }
        }
      }
    }
  }
  const activeGoals = goals.filter(goal => goal.status === "active");
  const activeExperiments = experiments.filter(experiment => ["planned", "running"].includes(experiment.status));
  const repeatCustomers = [...customerFrequency.values()].filter(count => count > 1).length;
  const topProduct = [...productFrequency.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const progressGoals = activeGoals.map(goal => {
    const target = Number(goal.target_value), current = Number(goal.current_value);
    return { id: goal.id, title: goal.title, status: goal.status, metric: goal.metric_name,
      currentValue: Number.isFinite(current) ? current : null, targetValue: Number.isFinite(target) ? target : null,
      progressPercent: Number.isFinite(target) && target > 0 && Number.isFinite(current) ? Math.max(0, Math.min(100, Math.round(current / target * 100))) : null };
  });
  const insights = [];
  if (additionalColumnFindings.length) {
    const selected = additionalColumnFindings.slice(0, 5);
    insights.push({
      type: "column_patterns", priority: "normal", title: "Patterns in additional dataset columns",
      summary: selected.map(item => item.column + " (" + item.dataset + "): " + item.summary).join(". ") +
        (additionalColumnFindings.length > selected.length ? ". " + (additionalColumnFindings.length - selected.length) + " more columns were profiled." : "."),
      evidence: "Calculated from non-empty values in imported columns that were not assigned to standard BusinessFlow fields.",
      recommendedAction: "Confirm what these columns represent, then map useful fields to the appropriate BusinessFlow metric. These exploratory patterns are not automatically treated as revenue, customers, or sales."
    });
  }
  if (!rows.length) insights.push({
    type: "data_needed", priority: "high", title: "Connect your first business dataset",
    summary: "BusinessFlow has no imported business records to analyse yet. Your saved goals and workspace context remain available, but revenue and customer conclusions would be guesses.",
    evidence: "0 imported records", recommendedAction: "Import a CSV or Excel file containing sales, orders, or customer records."
  });
  else {
    insights.push({ type: "coverage", priority: "normal", title: "Business data is available for analysis",
      summary: "BusinessFlow analysed " + rows.length + " imported records across " + imports.length + " dataset" + (imports.length === 1 ? "" : "s") + ".",
      evidence: datasetNames.map(item => item.name + " (" + item.rowCount + " rows)").join("; "),
      recommendedAction: "Review the mapped fields and keep this dataset updated as new business activity occurs." });
    if (revenueMapped && revenueValueCount) insights.push({
      type: "revenue", priority: "normal", title: "Revenue recorded in imported data",
      summary: "The imported records contain " + revenueValueCount + " readable revenue values totalling " + revenueTotal.toLocaleString("en-US", { maximumFractionDigits: 2 }) + " " + (profile.currency_code || "currency units") + ".",
      evidence: invalidRevenueValues ? invalidRevenueValues + " revenue cells could not be interpreted as numbers." : "All mapped revenue cells were numeric.",
      recommendedAction: invalidRevenueValues ? "Review blank or non-numeric revenue cells before relying on the total." : "Compare this total with the next reporting period after importing updated records."
    });
    else if (!revenueMapped) insights.push({
      type: "mapping", priority: "high", title: "Revenue is not mapped yet",
      summary: "The imported dataset does not identify a revenue or transaction-amount column, so BusinessFlow cannot calculate a verified revenue total.",
      evidence: rows.length + " records analysed; no revenue field mapped",
      recommendedAction: "Review the import column mapping and assign the correct amount column to Revenue."
    });
    if (customerMapped) insights.push({
      type: "customers", priority: repeatCustomers ? "normal" : "low", title: "Customer coverage",
      summary: customerIds.size + " distinct customers were identified in the imported records." + (repeatCustomers ? " " + repeatCustomers + " customers appear more than once." : " No repeat-customer pattern was found in these records."),
      evidence: "Customer identity was matched using the mapped customer ID, email, or customer name.",
      recommendedAction: repeatCustomers ? "Review repeat-customer frequency and identify which services or offers encourage another purchase." : "Import a longer customer history before drawing conclusions about retention."
    });
    else insights.push({
      type: "mapping", priority: "normal", title: "Customer identity is not mapped",
      summary: "BusinessFlow cannot estimate distinct or repeat customers without a customer ID, email, or customer-name field.",
      evidence: rows.length + " imported records", recommendedAction: "Map a stable customer identifier when reviewing your dataset."
    });
    if (topProduct) insights.push({
      type: "product", priority: "normal", title: "Most frequent product or service",
      summary: topProduct[0] + " appears most often in the imported records.",
      evidence: topProduct[1] + " records for this product or service",
      recommendedAction: "Compare its revenue and repeat-customer contribution before prioritising it."
    });
  }
  if (activeGoals.length) {
    const measurable = progressGoals.filter(goal => goal.progressPercent !== null);
    insights.push({ type: "goals", priority: "normal", title: "Active goals need regular review",
      summary: activeGoals.length + " active goal" + (activeGoals.length === 1 ? "" : "s") + " are being tracked." + (measurable.length ? " " + measurable.filter(goal => goal.progressPercent >= 100).length + " measurable goals have reached their target." : " Add current and target values to make progress measurable."),
      evidence: measurable.length + " of " + activeGoals.length + " active goals have numeric progress values.",
      recommendedAction: "Update goal progress after each reporting cycle and connect experiments to the goal they are intended to improve." });
  }
  if (activeExperiments.length) insights.push({
    type: "experiments", priority: "normal", title: "Experiments are in progress",
    summary: activeExperiments.length + " planned or running experiment" + (activeExperiments.length === 1 ? " is" : "s are") + " available for review.",
    evidence: activeExperiments.map(item => item.title).join("; "),
    recommendedAction: "Record the outcome and success metric when each experiment finishes."
  });
  const completedWithoutResults = experiments.some(item => {
    if (item.status !== "completed") return false;
    const summary = String(item.result_summary || "");
    if (summary.startsWith("BFEXP1:")) {
      try {
        const stored = JSON.parse(summary.slice(7));
        return stored.result === null || stored.result === undefined;
      } catch { return true; }
    }
    return !summary.trim();
  });
  if (completedWithoutResults) insights.push({
    type: "learning", priority: "normal", title: "Completed experiments need their results",
    summary: "At least one completed experiment has no recorded result summary.",
    evidence: "Completed experiment records", recommendedAction: "Add the observed result so future decisions can use what the business learned."
  });
  const sortedMonths = [...monthlyRevenue.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const sortedDates = dateValues.sort();
  return {
    status: "ok", engine: "businessflow_rules_v1", generatedAt: new Date().toISOString(),
    business: { id: profile.id, name: profile.name, currencyCode: profile.currency_code || "XOF", primaryGoal: profile.primary_goal || null },
    coverage: { datasetCount: imports.length, recordsAnalysed: rows.length, goalsCount: goals.length, activeGoalsCount: activeGoals.length,
      experimentsCount: experiments.length, activeExperimentsCount: activeExperiments.length, memoryCount: memory.length },
    metrics: {
      revenueTotal: revenueMapped && revenueValueCount ? Number(revenueTotal.toFixed(2)) : null,
      revenueCurrency: profile.currency_code || "XOF", revenueRecords: revenueValueCount,
      customers: customerMapped ? customerIds.size : null, repeatCustomers: customerMapped ? repeatCustomers : null,
      averageOrderValue: revenueValueCount ? Number((revenueTotal / revenueValueCount).toFixed(2)) : null,
      topProduct: topProduct ? { name: topProduct[0], records: topProduct[1] } : null,
      dateRange: sortedDates.length ? { from: sortedDates[0], to: sortedDates.at(-1) } : null,
      monthlyRevenue: sortedMonths.map(([month, total]) => ({ month, total: Number(total.toFixed(2)) }))
    },
    dataQuality: { revenueMapped, customerMapped, productMapped, dateMapped, invalidRevenueValues,
      notes: !rows.length ? ["No imported records are available."] : [
        ...(!revenueMapped ? ["Revenue field is not mapped."] : []),
        ...(!customerMapped ? ["Customer identity is not mapped."] : []),
        ...(invalidRevenueValues ? [invalidRevenueValues + " revenue cells are blank or non-numeric."] : [])
      ] },
    goals: progressGoals, insights
  };
}
