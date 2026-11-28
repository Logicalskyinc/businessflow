import { expect, test } from "@playwright/test";

const API_PREFIX = "/__mock-api";
const WORKSPACE_SCOPED_GETS = new Set([
  "/api/business-intelligence/activity",
  "/api/business-intelligence/conversations",
  "/api/business-intelligence/entitlements",
  "/api/business-intelligence/experiments",
  "/api/business-intelligence/goals",
  "/api/business-intelligence/insights",
  "/api/business-intelligence/memory",
  "/api/billing/entitlements",
  "/api/billing/subscription"
]);

function workspaceRecords(businessId) {
  const label = businessId === "workspace-a" ? "Workspace A" : "Workspace B";
  return {
    goals: [{
      id: businessId + "-goal",
      title: label + " goal",
      current_value: 2,
      target_value: 10,
      metric_name: "customers"
    }],
    experiments: [{
      id: businessId + "-experiment",
      title: label + " experiment",
      hypothesis: "The test hypothesis for " + label,
      baseline_value: 2,
      result_value: null,
      learning_notes: "",
      status: "running",
      started_at: "2026-11-01T00:00:00.000Z",
      completed_at: null,
      created_at: "2026-11-01T00:00:00.000Z",
      updated_at: "2026-11-01T00:00:00.000Z"
    }],
    memory: [{
      id: businessId + "-memory",
      category: "decision",
      content: {
        title: label + " memory",
        date: "2026-11-01",
        details: "A workspace-specific decision for " + label
      },
      created_at: "2026-11-01T00:00:00.000Z",
      updated_at: "2026-11-01T00:00:00.000Z"
    }],
    insights: {
      business: { id: businessId, name: label },
      engine: "businessflow_rules_v1",
      generatedAt: "2026-11-28T00:00:00.000Z",
      coverage: {
        recordsAnalysed: 1,
        datasetCount: 1,
        activeGoalsCount: 1,
        activeExperimentsCount: 1
      },
      metrics: { revenueTotal: 1200, revenueCurrency: "XOF", customers: 2 },
      insights: [{
        title: label + " insight",
        summary: "A workspace-specific insight.",
        evidence: "Mocked browser-test data",
        recommendedAction: "Review the workspace records.",
        priority: "high"
      }]
    },
    activity: [{
      id: businessId + "-activity",
      event_key: businessId + "-event",
      event_type: "goal_created",
      title: label + " activity",
      message: "A workspace-specific activity event.",
      entity_id: businessId + "-goal",
      created_at: "2026-11-28T00:00:00.000Z",
      is_read: false
    }],
    conversations: [{
      id: businessId + "-conversation",
      title: label + " conversation",
      updated_at: "2026-11-28T00:00:00.000Z"
    }]
  };
}

function mockApiResponse(path, businessId) {
  if (path === "/health") {
    return { status: "ok", service: "businessflow-backend", mode: "foundation" };
  }

  if (path === "/api/business-intelligence/businesses") {
    return {
      businesses: [
        { id: "workspace-a", name: "Workspace A", currency_code: "XOF" },
        { id: "workspace-b", name: "Workspace B", currency_code: "XOF" }
      ]
    };
  }

  if (path === "/api/billing/plans") {
    return {
      plans: [
        { plan_key: "workspace-a-plan", display_name: "Workspace A Plan", features: [], prices: [] },
        { plan_key: "workspace-b-plan", display_name: "Workspace B Plan", features: [], prices: [] }
      ]
    };
  }

  if (path === "/api/billing/subscription") {
    return {
      subscription: businessId ? {
        plan_key: businessId + "-plan",
        status: "active",
        current_period_end: null,
        cancel_at_period_end: false
      } : null
    };
  }

  if (path === "/api/billing/entitlements") {
    return { entitlements: [{ feature_key: "workspace_" + businessId, enabled: true }] };
  }

  if (!businessId) return {};

  const records = workspaceRecords(businessId);

  if (path === "/api/business-intelligence/goals") return { goals: records.goals };
  if (path === "/api/business-intelligence/experiments") return { experiments: records.experiments };
  if (path === "/api/business-intelligence/memory") return { memory: records.memory };
  if (path === "/api/business-intelligence/insights") return records.insights;
  if (path === "/api/business-intelligence/activity") return { activity: records.activity };
  if (path === "/api/business-intelligence/conversations") return { conversations: records.conversations };
  if (path === "/api/business-intelligence/imports") return { imports: [] };

  const messageMatch = path.match(/^\/api\/business-intelligence\/conversations\/([^/]+)\/messages$/);
  if (messageMatch) {
    const messageWorkspace = messageMatch[1].startsWith("workspace-a-") ? "Workspace A" : "Workspace B";
    return { messages: [{ role: "assistant", content: messageWorkspace + " Grey message" }] };
  }

  return {};
}

async function installApp(page, { holdWorkspaceA = false } = {}) {
  let releaseWorkspaceA;
  const workspaceAGate = new Promise(resolve => {
    releaseWorkspaceA = resolve;
  });
  let workspaceARequestsStarted = 0;
  let workspaceARequestsCompleted = 0;

  await page.route("**/frontend-config.js", route => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: `window.BUSINESSFLOW_CONFIG = Object.freeze({
      supabaseUrl: "https://mock.supabase.invalid",
      supabasePublishableKey: "e2e-public-key",
      apiBaseUrl: window.location.origin + "/__mock-api"
    });`
  }));

  await page.route("https://esm.sh/**", route => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    headers: { "access-control-allow-origin": "*" },
    body: `export function createClient() {
      const session = {
        access_token: "playwright-test-token",
        user: {
          id: "playwright-test-user",
          email: "browser-test@example.invalid",
          user_metadata: { businessflow_onboarding_skipped: true }
        }
      };
      return {
        auth: {
          getSession: async () => ({ data: { session }, error: null }),
          onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
          signOut: async () => ({ error: null }),
          updateUser: async () => ({ error: null })
        }
      };
    }`
  }));

  await page.route("https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js", route => route.fulfill({
    status: 200,
    contentType: "application/javascript",
    body: "window.XLSX = {};"
  }));

  await page.route("**/__mock-api/**", async route => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS",
          "access-control-allow-headers": "Authorization,Content-Type,Idempotency-Key"
        }
      });
      return;
    }

    const url = new URL(request.url());
    const path = url.pathname.slice(API_PREFIX.length);
    const businessId = url.searchParams.get("business_id");
    const shouldHold = holdWorkspaceA &&
      request.method() === "GET" &&
      businessId === "workspace-a" &&
      WORKSPACE_SCOPED_GETS.has(path);

    if (shouldHold) {
      workspaceARequestsStarted += 1;
      await workspaceAGate;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(mockApiResponse(path, businessId))
    });

    if (shouldHold) workspaceARequestsCompleted += 1;
  });

  await page.goto("/#overview", { waitUntil: "domcontentloaded" });
  await expect(page.locator("#business-workspace-select")).toBeEnabled();
  await expect(page.locator("#business-workspace-select option")).toHaveCount(3);

  return {
    releaseWorkspaceA: () => releaseWorkspaceA(),
    get workspaceARequestsStarted() { return workspaceARequestsStarted; },
    get workspaceARequestsCompleted() { return workspaceARequestsCompleted; }
  };
}

async function expectWorkspaceBVisible(page) {
  await expect(page.locator("#goal-list")).toContainText("Workspace B goal");
  await expect(page.locator("#experiment-list")).toContainText("Workspace B experiment");
  await expect(page.locator("#memory-list")).toContainText("Workspace B memory");
  await expect(page.locator("#overview-insights")).toContainText("Workspace B insight");
  await expect(page.locator("#activity-feed")).toContainText("Workspace B activity");
  await expect(page.locator("#bf-conversation-list")).toContainText("Workspace B conversation");
  await expect(page.locator("#billing-current-plan")).toHaveText("Workspace B Plan");
}

test("workspace switching ignores late responses from the previous workspace", async ({ page }) => {
  const harness = await installApp(page, { holdWorkspaceA: true });

  try {
    await expect.poll(() => harness.workspaceARequestsStarted).toBeGreaterThanOrEqual(8);

    await page.locator('.nav-link[data-page="settings"]').click();
    await page.locator("#business-workspace-select").selectOption("workspace-b");
    await expectWorkspaceBVisible(page);

    harness.releaseWorkspaceA();
    await expect.poll(() => harness.workspaceARequestsCompleted)
      .toBe(harness.workspaceARequestsStarted);

    await expect(page.locator("#goal-list")).not.toContainText("Workspace A");
    await expect(page.locator("#experiment-list")).not.toContainText("Workspace A");
    await expect(page.locator("#memory-list")).not.toContainText("Workspace A");
    await expect(page.locator("#overview-insights")).not.toContainText("Workspace A");
    await expect(page.locator("#activity-feed")).not.toContainText("Workspace A");
    await expect(page.locator("#bf-conversation-list")).not.toContainText("Workspace A");
    await expect(page.locator("#billing-current-plan")).toHaveText("Workspace B Plan");
  } finally {
    harness.releaseWorkspaceA();
  }
});

test("sign-out invalidates all pending workspace responses", async ({ page }) => {
  const harness = await installApp(page, { holdWorkspaceA: true });

  try {
    await expect.poll(() => harness.workspaceARequestsStarted).toBeGreaterThanOrEqual(8);
    await page.locator("#sidebar-signout").click();
    await expect(page.locator("#account")).toHaveClass(/active/);

    harness.releaseWorkspaceA();
    await expect.poll(() => harness.workspaceARequestsCompleted)
      .toBe(harness.workspaceARequestsStarted);

    await expect(page.locator("#account")).toHaveClass(/active/);
    await expect(page.locator("#goal-list")).not.toContainText("Workspace A");
    await expect(page.locator("#experiment-list")).not.toContainText("Workspace A");
    await expect(page.locator("#memory-list")).not.toContainText("Workspace A");
    await expect(page.locator("#overview-insights")).not.toContainText("Workspace A");
    await expect(page.locator("#activity-feed")).not.toContainText("Workspace A");
    await expect(page.locator("#bf-conversation-list")).not.toContainText("Workspace A");
    await expect(page.locator("#billing-current-plan")).toHaveText("Starter");
    await expect(page.locator("#business-workspace-select")).toBeDisabled();
  } finally {
    harness.releaseWorkspaceA();
  }
});

test("browser Back and Forward restore the selected page", async ({ page }) => {
  await installApp(page);

  await page.locator('.nav-link[data-page="analytics"]').click();
  await expect(page.locator("#analytics")).toHaveClass(/active/);
  await page.locator('.nav-link[data-page="goals"]').click();
  await expect(page.locator("#goals")).toHaveClass(/active/);

  await page.goBack();
  await expect(page.locator("#analytics")).toHaveClass(/active/);
  await page.goBack();
  await expect(page.locator("#overview")).toHaveClass(/active/);
  await page.goForward();
  await expect(page.locator("#analytics")).toHaveClass(/active/);
});

test.describe("mobile navigation", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("mobile tabs navigate and the menu closes on Escape", async ({ page }) => {
    await installApp(page);

    await page.locator('.mobile-tab[data-page="analytics"]').click();
    await expect(page.locator("#analytics")).toHaveClass(/active/);
    await page.locator('.mobile-tab[data-page="goals"]').click();
    await expect(page.locator("#goals")).toHaveClass(/active/);

    const menuButton = page.locator(".menu-button");
    await menuButton.click();
    await expect(menuButton).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(menuButton).toHaveAttribute("aria-expanded", "false");
  });
});
