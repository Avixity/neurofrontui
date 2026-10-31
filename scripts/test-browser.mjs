import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

const output = path.resolve(".work/qa");
await fs.mkdir(output, { recursive: true });
const url = process.env.QA_URL || "http://localhost:4180";
const report = {
  url,
  environment: `Headless Chromium on ${process.platform}/${process.arch}; simulated peripheral, real browser timers; no physical Bluetooth tested.`,
  checks: [],
  errors: [],
  images: [],
};
const check = (name, pass, detail = null) => {
  report.checks.push({ name, pass: !!pass, detail });
  console.log(
    `${pass ? "PASS" : "FAIL"} ${name}${detail ? ` ${JSON.stringify(detail)}` : ""}`,
  );
};
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
});
report.browserVersion = browser.version();
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
page.on("pageerror", (error) =>
  report.errors.push(`pageerror: ${error.message}`),
);
page.on("console", (message) => {
  if (message.type() === "error")
    report.errors.push(`console: ${message.text()}`);
});
page.on("response", (response) => {
  if (response.status() >= 400)
    report.errors.push(`${response.status()} ${response.url()}`);
});
const shot = async (name) => {
  const file = path.join(output, `dashboard-${name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  report.images.push(file);
};
const guest = () =>
  page.evaluate(() =>
    JSON.parse(sessionStorage.getItem("neurofront.guest.v2") || "{}"),
  );
const graph = page.locator(".signal-canvas");
const stats = () =>
  page.evaluate(() => window.__neurofrontSimulation?.getStats());
const noOverflow = () =>
  page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
try {
  await page.goto(`${url}/?simulate=1`, { waitUntil: "networkidle" });
  report.bundles = await page
    .locator("script[src]")
    .evaluateAll((scripts) => scripts.map((script) => script.src));
  await page
    .getByRole("button", { name: "Continue as guest", exact: true })
    .waitFor();
  await shot("auth-desktop");
  check("auth does not auto-connect", (await stats())?.requests === 0);
  await page
    .getByRole("button", { name: "Continue as guest", exact: true })
    .click();
  await page.getByRole("button", { name: "Measure", exact: true }).click();
  check(
    "explicit simulation label visible",
    await page.getByText("SIMULATED INPUT", { exact: true }).isVisible(),
  );
  check(
    "connection has not auto-calibrated",
    (await guest()).baselines.length === 0 &&
      (await page.getByRole("timer").count()) === 0,
  );
  await page
    .locator(".session-panel")
    .getByRole("button", { name: "Connect device", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Record baseline", exact: true })
    .waitFor();
  await page.waitForTimeout(700);
  check(
    "one explicit connection with live notifications",
    (await stats()).requests === 1 && (await stats()).notifications > 0,
    await stats(),
  );
  check(
    "connection alone never records a baseline",
    (await guest()).baselines.length === 0 &&
      (await page.getByRole("timer").count()) === 0,
  );
  await shot("measure-before-baseline");
  const baselineStarted = Date.now();
  await page
    .getByRole("button", { name: "Record baseline", exact: true })
    .click();
  await page.getByRole("timer").waitFor();
  await page.waitForTimeout(1200);
  await shot("baseline-running");
  await page
    .getByRole("button", { name: "Start 15-second capture", exact: true })
    .waitFor({ timeout: 26000 });
  const baselineElapsed = Date.now() - baselineStarted;
  const baseline = (await guest()).baselines[0];
  check(
    "baseline uses elapsed20s",
    baselineElapsed >= 19500 &&
      baselineElapsed < 25000 &&
      baseline.durationMs === 20000,
    { elapsed: baselineElapsed, samples: baseline.sampleCount },
  );
  check(
    "baseline contains only received primary samples",
    baseline.device.source === "simulated" &&
      baseline.sampleCount >= 350 &&
      baseline.sampleCount <= 410 &&
      baseline.traces.temperature.length === 0 &&
      baseline.traces.gsr.length === 0 &&
      baseline.traces.primary.every(
        (s, i, a) => s.t < 20000 && (!i || s.timestamp > a[i - 1].timestamp),
      ),
  );
  await page.evaluate(() => window.__neurofrontSimulation.setMode("active"));
  const captureStarted = Date.now();
  await page
    .getByRole("button", { name: "Start 15-second capture", exact: true })
    .click();
  await page.waitForTimeout(1000);
  await page
    .locator(".graph-switches")
    .getByRole("button", { name: "Primary signal", exact: true })
    .click();
  await page.waitForTimeout(150);
  const hiddenDraws = Number(await graph.getAttribute("data-draws"));
  await page.waitForTimeout(700);
  check(
    "all-hidden channels stop canvas redraw without stopping recording",
    Number(await graph.getAttribute("data-draws")) === hiddenDraws &&
      (await page.getByRole("timer").count()) === 1,
  );
  await page
    .locator(".graph-switches")
    .getByRole("button", { name: "Temperature", exact: true })
    .click();
  await page.waitForTimeout(300);
  await shot("unreceived-temperature");
  await page
    .locator(".graph-switches")
    .getByRole("button", { name: "Temperature", exact: true })
    .click();
  await page
    .locator(".graph-switches")
    .getByRole("button", { name: "Primary signal", exact: true })
    .click();
  await page
    .locator(".graph-switches")
    .getByRole("button", { name: "Personal baseline", exact: true })
    .click();
  await page.waitForTimeout(300);
  await page
    .locator(".graph-switches")
    .getByRole("button", { name: "Personal baseline", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Your session, in context.", exact: true })
    .waitFor({ timeout: 22000 });
  const captureElapsed = Date.now() - captureStarted,
    record = (await guest()).measurements[0];
  check(
    "capture finishes15s with actual samples despite switches",
    captureElapsed >= 14500 &&
      captureElapsed < 20000 &&
      record.durationMs === 15000 &&
      record.sampleCount >= 260 &&
      record.sampleCount <= 310,
    { elapsed: captureElapsed, samples: record.sampleCount },
  );
  check(
    "capture pins exact baseline and leaves unreceived channels empty",
    JSON.stringify(record.baseline) === JSON.stringify(baseline) &&
      record.baselineId === baseline.id &&
      record.traces.temperature.length === 0 &&
      record.traces.gsr.length === 0,
  );
  const activity = (f) =>
    f.stdDev * 0.5 + f.peakToPeak * 0.35 + f.derivativeMean * 0.15;
  const base = Math.max(1, activity(record.baseline.features));
  const expected = Math.max(
    0,
    Math.min(100, 50 + ((activity(record.features) - base) / base) * 38),
  );
  check(
    "result uses preserved baseline-relative formula",
    record.status === "completed" &&
      record.score === expected &&
      record.device.source === "simulated",
    { score: record.score },
  );
  await fs.writeFile(
    path.join(output, "simulated-guest-session.json"),
    JSON.stringify(await guest(), null, 2),
  );
  check(
    "display switches never reconnect Bluetooth",
    (await stats()).requests === 1,
  );
  await page.waitForTimeout(250);
  const idleDraws = Number(await graph.getAttribute("data-draws"));
  await page.waitForTimeout(800);
  check(
    "completed graph draws remain idle while peripheral continues",
    Number(await graph.getAttribute("data-draws")) === idleDraws,
    { draws: idleDraws, notifications: (await stats()).notifications },
  );
  await shot("result-desktop");
  check("desktop result has no horizontal overflow", await noOverflow());
  const png = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export PNG", exact: true }).click();
  const download = await png;
  const pngPath = path.join(output, "dashboard-export.png");
  await download.saveAs(pngPath);
  check(
    "PNG export downloads recorded chart",
    (await fs.stat(pngPath)).size > 2000,
  );
  report.images.push(pngPath);
  const csvDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV", exact: true }).click();
  const csv = await csvDownload,
    csvPath = path.join(output, "dashboard-export.csv");
  await csv.saveAs(csvPath);
  const rows = (await fs.readFile(csvPath, "utf8"))
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/)
    .slice(1);
  const measurementRows = rows.filter((row) => row.includes(',"measurement",'));
  const baselineRows = rows.filter((row) => row.includes(',"baseline",'));
  check(
    "CSV exports exactly received measurement and baseline samples",
    measurementRows.length === record.sampleCount &&
      baselineRows.length === baseline.sampleCount &&
      rows.length === record.sampleCount + baseline.sampleCount,
  );
  check(
    "CSV retains source, receipt timestamps, elapsed times and actual values",
    measurementRows.every((row, i) => {
      const sample = record.traces.primary[i];
      return (
        row ===
        [
          record.id,
          "simulated",
          "measurement",
          new Date(sample.timestamp).toISOString(),
          sample.t,
          "primary",
          record.units.primary,
          sample.value,
        ]
          .map((value) => `"${value}"`)
          .join(",")
      );
    }),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await graph.scrollIntoViewIfNeeded();
  await page.waitForTimeout(350);
  await shot("result-mobile");
  check("390px result has no overflow", await noOverflow());
  await page.getByRole("button", { name: "New session", exact: true }).click();
  await page.getByRole("button", { name: "Recalibrate", exact: true }).click();
  await page.waitForTimeout(900);
  await page
    .locator(".session-panel")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  check(
    "cancelled recalibration retains prior baseline",
    (await guest()).activeBaselineId === baseline.id &&
      (await guest()).baselines.length === 1,
  );
  await page
    .locator(".session-panel")
    .getByRole("button", { name: "Use saved baseline", exact: true })
    .click();
  check(
    "saved baseline selection is explicit and does not start capture",
    (await page.getByRole("timer").count()) === 0,
  );
  await page
    .locator(".session-panel")
    .getByRole("button", { name: "Start 15-second capture", exact: true })
    .click();
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__neurofrontSimulation.disconnect());
  await page.getByText("Interrupted capture", { exact: true }).waitFor();
  const interrupted = (await guest()).measurements[0];
  check(
    "disconnect produces reviewable interrupted capture with no score",
    interrupted.status === "interrupted" &&
      interrupted.score === null &&
      interrupted.baselineId === baseline.id &&
      interrupted.quality.issues.includes("disconnected"),
  );
  await shot("interrupted-mobile");
  await page.setViewportSize({ width: 320, height: 740 });
  await graph.scrollIntoViewIfNeeded();
  await page.waitForTimeout(350);
  check("320px no horizontal overflow", await noOverflow());
  await shot("interrupted-narrow");
  const beforeRefresh = await guest();
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByRole("navigation", { name: "NeuroFront", exact: true })
    .getByRole("button", { name: "History", exact: true })
    .click();
  const afterRefresh = await guest();
  check(
    "guest refresh restores history and selected baseline without reconnecting",
    JSON.stringify(afterRefresh) === JSON.stringify(beforeRefresh) &&
      afterRefresh.activeBaselineId === baseline.id &&
      afterRefresh.measurements.length === 2 &&
      (await stats()).requests === 0,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  check(
    "reduced-motion mobile history remains usable without overflow",
    (await noOverflow()) &&
      (await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      )),
  );
  await shot("history-reduced-mobile");
  check(
    "no missing images",
    await page
      .locator("img")
      .evaluateAll((images) =>
        images.every((img) => img.complete && img.naturalWidth > 0),
      ),
  );
  check("no browser/HTTP errors", report.errors.length === 0, report.errors);
} catch (error) {
  report.errors.push(error.stack || String(error));
  console.error(error);
  await shot("failure").catch(() => {});
} finally {
  report.passed = report.checks.filter((c) => c.pass).length;
  report.failed = report.checks.filter((c) => !c.pass).length;
  await fs.writeFile(
    path.join(output, "core-browser-report.json"),
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  console.log(
    JSON.stringify(
      { passed: report.passed, failed: report.failed, errors: report.errors },
      null,
      2,
    ),
  );
  if (report.failed || report.errors.length) process.exitCode = 1;
}
