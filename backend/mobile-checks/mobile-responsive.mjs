import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit, devices } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const widths = [320, 360, 390, 430];
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function startStaticServer() {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      const requested = pathname === "/" ? "/index.html" : pathname;
      const filePath = path.resolve(repoRoot, "." + requested);
      if (!filePath.startsWith(repoRoot + path.sep)) {
        res.writeHead(403).end("Forbidden");
        return;
      }
      const body = await readFile(filePath);
      res.writeHead(200, { "content-type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("Not found");
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function closeStaticServer(server) {
  // Browser keep-alive sockets must not hold the Node test process open.
  server.closeAllConnections?.();
  if (server.listening) {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
}

async function inspectViewport(browser, device, url, width, height) {
  const context = await browser.newContext({
    ...device,
    viewport: { width, height },
    isMobile: true,
    hasTouch: true,
    javaScriptEnabled: false
  });
  try {
    const page = await context.newPage();
    await page.route("**/*", route => {
      const hostname = new URL(route.request().url()).hostname;
      return hostname === "127.0.0.1" ? route.continue() : route.abort();
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12_000 });
    await page.locator("body").evaluate(body => {
      body.classList.remove("auth-pending", "auth-required");
    });
    return await page.evaluate(() => {
      const rect = selector => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return { width: box.width, height: box.height, display: style.display };
      };
      return {
        viewportWidth: window.innerWidth,
        documentWidth: document.documentElement.scrollWidth,
        menu: rect(".menu-button"),
        topbarAction: rect(".topbar-icon-button"),
        mobileNav: rect(".mobile-tabbar"),
        mobileTabs: [...document.querySelectorAll(".mobile-tab")].map(element => {
          const box = element.getBoundingClientRect();
          return { width: box.width, height: box.height };
        }),
        analyticsControlFontSizes: [...document.querySelectorAll(".analytics-filter-bar input, .analytics-filter-bar select")]
          .map(element => Number.parseFloat(getComputedStyle(element).fontSize))
      };
    });
  } finally {
    await context.close();
  }
}

function assertMobileLayout(layout, width, label) {
  assert.ok(layout.documentWidth <= width + 1,
    `${label}: horizontal overflow (${layout.documentWidth}px document)`);
  assert.ok(layout.menu && layout.menu.display !== "none",
    `${label}: mobile menu is not visible`);
  assert.ok(layout.menu.width >= 44 && layout.menu.height >= 44,
    `${label}: menu target is smaller than 44x44px`);
  assert.ok(layout.topbarAction && layout.topbarAction.width >= 44 && layout.topbarAction.height >= 44,
    `${label}: topbar action target is smaller than 44x44px`);
  assert.ok(layout.mobileNav && layout.mobileNav.display !== "none",
    `${label}: bottom navigation is not visible`);
  assert.equal(layout.mobileTabs.length, 5, `${label}: expected five quick-navigation items`);
  assert.ok(layout.mobileTabs.every(tab => tab.height >= 44),
    `${label}: a bottom navigation target is shorter than 44px`);
  assert.ok(layout.analyticsControlFontSizes.every(size => size >= 16),
    `${label}: analytics control text is below 16px`);
}

async function runMobileEngine(name, browserType, device) {
  const { server, url } = await startStaticServer();
  let browser;
  try {
    console.log(`[mobile-check] Launching ${name}`);
    browser = await browserType.launch({ headless: true, timeout: 20_000 });
    for (const width of widths) {
      console.log(`[mobile-check] ${name}: checking ${width}px`);
      const layout = await inspectViewport(browser, device, url, width, 844);
      assertMobileLayout(layout, width, `${name} at ${width}px`);
      console.log(`[mobile-check] ${name}: ${width}px passed`);
    }
  } finally {
    if (browser) {
      console.log(`[mobile-check] Closing ${name}`);
      await browser.close();
      console.log(`[mobile-check] Closed ${name}`);
    }
    await closeStaticServer(server);
  }
}

test("iPhone Safari mobile layouts stay usable at narrow widths", { timeout: 90_000 }, async () => {
  await runMobileEngine("iPhone Safari WebKit", webkit, devices["iPhone 13"]);
});

test("Android Chrome mobile layouts stay usable at narrow widths", { timeout: 90_000 }, async () => {
  await runMobileEngine("Android Chrome", chromium, devices["Pixel 7"]);
});

test("tablet viewport does not show the mobile bottom navigation", { timeout: 30_000 }, async () => {
  const { server, url } = await startStaticServer();
  let browser;
  let context;
  try {
    browser = await chromium.launch({ headless: true, timeout: 20_000 });
    context = await browser.newContext({
      viewport: { width: 768, height: 1024 },
      javaScriptEnabled: false
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 12_000 });
    await page.locator("body").evaluate(body => body.classList.remove("auth-pending", "auth-required"));
    const layout = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      mobileNavDisplay: getComputedStyle(document.querySelector(".mobile-tabbar")).display
    }));
    assert.ok(layout.documentWidth <= layout.width + 1, "tablet layout has horizontal overflow");
    assert.equal(layout.mobileNavDisplay, "none", "mobile bottom navigation should be hidden at tablet width");
  } finally {
    if (context) await context.close();
    if (browser) await browser.close();
    await closeStaticServer(server);
  }
});
