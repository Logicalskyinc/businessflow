import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, webkit, devices } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function startStaticServer() {
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
  return new Promise(resolve => server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    resolve({ server, url: `http://127.0.0.1:${address.port}` });
  }));
}

async function inspectMobileViewport(browser, device, width, height) {
  const context = await browser.newContext({
    ...device,
    viewport: { width, height },
    isMobile: true,
    hasTouch: true
  });
  const page = await context.newPage();
  await page.setJavaScriptEnabled(false);
  // Layout tests do not need application bundles or third-party scripts.
  await page.route("**/*", route => {
    const hostname = new URL(route.request().url()).hostname;
    return hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
  await page.goto(globalThis.__mobileTestUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
  await page.locator("body").evaluate(body => {
    body.classList.remove("auth-pending", "auth-required");
  });

  const layout = await page.evaluate(() => {
    const rect = selector => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { width: box.width, height: box.height, display: style.display, position: style.position };
    };
    const controls = [...document.querySelectorAll(".analytics-filter-bar input, .analytics-filter-bar select")]
      .map(element => Number.parseFloat(getComputedStyle(element).fontSize));
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
      analyticsControlFontSizes: controls
    };
  });
  await context.close();
  return layout;
}

test("iPhone Safari and Android Chrome mobile layouts stay usable at narrow widths", { timeout: 120_000 }, async () => {
  const { server, url } = await startStaticServer();
  globalThis.__mobileTestUrl = url;
  const browserRuns = [
    { name: "iPhone Safari WebKit", browserType: webkit, device: devices["iPhone 13"] },
    { name: "Android Chrome", browserType: chromium, device: devices["Pixel 7"] }
  ];
  const failures = [];

  try {
    for (const run of browserRuns) {
      const browser = await run.browserType.launch({ headless: true, timeout: 30_000 });
      try {
        for (const width of [320, 360, 390, 430]) {
          const layout = await inspectMobileViewport(browser, run.device, width, 844);
          const label = `${run.name} at ${width}px`;
          assert.ok(layout.documentWidth <= width + 1,
            `${label}: horizontal page overflow (${layout.documentWidth}px document)`);
          assert.ok(layout.menu && layout.menu.display !== "none",
            `${label}: mobile navigation menu is not visible`);
          assert.ok(layout.menu.width >= 44 && layout.menu.height >= 44,
            `${label}: menu button is smaller than 44x44px`);
          assert.ok(layout.topbarAction && layout.topbarAction.width >= 44 && layout.topbarAction.height >= 44,
            `${label}: topbar action target is smaller than 44x44px`);
          assert.ok(layout.mobileNav && layout.mobileNav.display !== "none",
            `${label}: bottom navigation is not visible`);
          assert.equal(layout.mobileTabs.length, 5, `${label}: expected five quick-navigation items`);
          assert.ok(layout.mobileTabs.every(tab => tab.height >= 44),
            `${label}: one or more bottom navigation targets are smaller than 44px high`);
          assert.ok(layout.analyticsControlFontSizes.every(size => size >= 16),
            `${label}: analytics form control text is below 16px`);
        }
      } catch (error) {
        failures.push(`${run.name}: ${error.message}`);
      } finally {
        await browser.close();
      }
    }
    assert.deepEqual(failures, []);
  } finally {
    delete globalThis.__mobileTestUrl;
    await new Promise(resolve => server.close(resolve));
  }
});

test("tablet viewport does not show the mobile bottom navigation", { timeout: 30_000 }, async () => {
  const { server, url } = await startStaticServer();
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 768, height: 1024 } });
    await page.setJavaScriptEnabled(false);
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.locator("body").evaluate(body => body.classList.remove("auth-pending", "auth-required"));
    const layout = await page.evaluate(() => ({
      width: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      mobileNavDisplay: getComputedStyle(document.querySelector(".mobile-tabbar")).display
    }));
    await browser.close();
    assert.ok(layout.documentWidth <= layout.width + 1, "tablet layout has horizontal page overflow");
    assert.equal(layout.mobileNavDisplay, "none", "mobile bottom navigation should be hidden at tablet width");
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
