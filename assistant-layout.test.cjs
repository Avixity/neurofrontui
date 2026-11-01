"use strict"
const assert = require("node:assert/strict")
const path = require("node:path")
const os = require("node:os")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const url = process.env.NEUROFRONT_URL || "http://127.0.0.1:5183"
const screenshotDir = process.env.NEUROFRONT_SCREENSHOT_DIR || os.tmpdir()
let browser
const startupErrors = []

;(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined })
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  const errors = []
  let requests = 0, held = null, mode = "hold"
  page.on("pageerror", error => { errors.push(error.message); startupErrors.push(error.message) })
  await page.route("**/api/assistant", route => {
    requests++
    if (mode === "hold") { held = route; return }
    if (mode === "long") return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ paragraphs: [
      "Review the saved capture alongside its own baseline. The score describes how this prototype compares changes in the recorded signal with that reference. It does not tell you why a reading changed or identify a medical condition.",
      "There are no comparable earlier captures in this synthetic example. That means a trend comparison is unavailable. Keep the original baseline and capture together when you review the graph later, so a new calibration does not change what this recording meant.",
      "For a repeat reading, take a moment to sit comfortably and check the illustrated placement guide. Keep the connecting wires supported and avoid changing the contacts during recording. Consistent preparation gives you a clearer basis for comparing sessions.",
      "If you want to understand a particular part of the graph, ask about that feature or open the related guide below. Consider the experimental reading alongside how you feel, rather than treating one number as a diagnosis."
    ], resourceIds: ["baseline", "placement"] }) })
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ paragraphs: ["Use a comfortable seated position and check the illustrated setup guide before measuring."], resourceIds: ["placement"] }) })
  })
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
  await page.waitForFunction(() => window.NeuroFrontAssistant && document.body.classList.contains("is-ready"))
  assert.equal(await page.locator("#assistantPanel").isVisible(), false)
  assert.equal(await page.locator("#assistantLauncherLabel").textContent(), "NeuroFront AI")
  await page.waitForFunction(() => document.getElementById("assistantLaunchArea").classList.contains("is-callout-visible"))
  await page.screenshot({ animations: "disabled", path: path.join(screenshotDir, "neurofront-ai-launcher-desktop.png") })
  await page.waitForFunction(() => !document.getElementById("assistantLaunchArea").classList.contains("is-callout-visible"), null, { timeout: 5000 })
  const before = await page.locator(".dashboard").boundingBox()
  await page.locator("#assistantLauncher").click()
  assert.equal(await page.locator("#assistantLaunchArea").isVisible(), false)
  assert.equal(await page.locator("#assistantTitle").textContent(), "NeuroFront AI")
  assert.equal(await page.locator('[data-kind="greeting"]').count(), 1)
  assert.equal(requests, 0, "Opening chat does not call the model")
  assert.equal(await page.locator(".assistant-starters, .assistant-privacy, .assistant-toolbar").count(), 0)
  assert.deepEqual(await page.locator(".dashboard").boundingBox(), before)
  const layout = await page.evaluate(() => {
    const get = id => document.getElementById(id).getBoundingClientRect()
    const panel = get("assistantPanel"), title = get("assistantTitle"), newChat = get("assistantNewChat"), close = get("assistantClose")
    return { background: getComputedStyle(document.getElementById("assistantPanel")).backgroundColor, panelHeight: panel.height,
      messagesHeight: get("assistantMessages").height, composerHeight: get("assistantForm").height,
      titleCenter: title.y + title.height / 2, newCenter: newChat.y + newChat.height / 2, closeCenter: close.y + close.height / 2,
      panelBottom: panel.bottom, viewportHeight: innerHeight }
  })
  assert.equal(layout.background, "rgb(250, 251, 247)")
  assert.ok(layout.messagesHeight > layout.panelHeight * 0.7, JSON.stringify(layout))
  assert.ok(layout.composerHeight < 90, JSON.stringify(layout))
  assert.ok(Math.abs(layout.titleCenter - layout.newCenter) < 2 && Math.abs(layout.titleCenter - layout.closeCenter) < 2)
  assert.ok(layout.viewportHeight - layout.panelBottom < 25)
  await page.screenshot({ animations: "disabled", path: path.join(screenshotDir, "neurofront-ai-greeting-desktop.png") })
  await page.locator("#assistantInput").fill("How should I prepare?")
  await page.locator("#assistantSend").click()
  await page.waitForFunction(() => document.querySelectorAll(".assistant-typing span").length === 3)
  assert.equal(await page.locator("#assistantNotice").isVisible(), false)
  await page.screenshot({ animations: "disabled", path: path.join(screenshotDir, "neurofront-ai-typing-desktop.png") })
  assert.ok(held)
  await held.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable" } }) })
  await page.waitForFunction(() => Boolean(document.querySelector(".assistant-inline-retry")))
  assert.equal(await page.locator(".assistant-inline-retry").textContent(), "Couldn’t load. Try again.")
  assert.equal(await page.locator(".assistant-inline-retry").count(), 1)
  assert.equal(await page.locator("#assistantNotice").isVisible(), false)
  await page.screenshot({ animations: "disabled", path: path.join(screenshotDir, "neurofront-ai-inline-retry-desktop.png") })
  mode = "success"
  await page.locator(".assistant-inline-retry").click()
  await page.waitForFunction(() => document.getElementById("assistantMessages").textContent.includes("comfortable seated"))
  assert.equal(await page.locator('[data-role="user"]').count(), 1)
  assert.equal(await page.locator(".assistant-inline-status").count(), 0)
  const draft = "Keep this draft"
  await page.locator("#assistantInput").fill(draft)
  await page.keyboard.press("Escape")
  assert.equal(await page.locator("#assistantLaunchArea").isVisible(), true)
  await page.locator("#assistantLauncher").click()
  assert.equal(await page.locator("#assistantInput").inputValue(), draft)
  assert.equal(await page.locator('[data-kind="greeting"]').count(), 1)
  mode = "long"
  await page.evaluate(() => NeuroFrontAssistant.explain({
    id: "00000000-0000-4000-8000-000000000701", completedAt: "2026-11-01T09:00:15.000Z", durationMs: 15000,
    calculationVersion: "neurofront-stress-v1", unit: "mV", samples: [1, 2, 1], stress: { score: 72, label: "Elevated" },
    summary: { average: 2, peak: 4, minimum: 1, activityLabel: "Stable" },
    baseline: { createdAt: "2026-11-01T08:00:00.000Z", calculationVersion: "neurofront-stress-v1", unit: "mV", sampleIntervalMs: 50, durationMs: 20000, mean: 1, rms: 1, stdDev: 1, peakToPeak: 2, derivativeMean: 1, samples: [1, 1, 2] }
  }))
  await page.waitForFunction(() => document.getElementById("assistantMessages").textContent.includes("Review the saved capture"))
  assert.equal(await page.locator("#assistantContext").isVisible(), true)
  assert.ok((await page.locator("#assistantContext").boundingBox()).height < 55)
  await page.screenshot({ animations: "disabled", path: path.join(screenshotDir, "neurofront-ai-measurement-desktop.png") })
  for (const size of [{ width: 390, height: 844 }, { width: 320, height: 740 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(size)
    const bounds = await page.evaluate(() => {
      const panel = document.getElementById("assistantPanel"), rect = panel.getBoundingClientRect()
      return { width: innerWidth, height: innerHeight, documentWidth: document.documentElement.scrollWidth,
        left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, inner: panel.scrollWidth, client: panel.clientWidth }
    })
    assert.ok(bounds.documentWidth <= bounds.width + 1 && bounds.inner <= bounds.client + 1, JSON.stringify(bounds))
    assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.top >= 0 && bounds.bottom <= bounds.height, JSON.stringify(bounds))
    assert.equal(await page.locator("#assistantNewChat").isVisible(), true)
    if (size.width === 390) await page.screenshot({ animations: "disabled", path: path.join(screenshotDir, "neurofront-ai-chat-mobile.png") })
    if (size.width === 320) await page.screenshot({ animations: "disabled", path: path.join(screenshotDir, "neurofront-ai-chat-narrow.png") })
    if (size.height === 390) await page.screenshot({ animations: "disabled", path: path.join(screenshotDir, "neurofront-ai-chat-landscape.png") })
  }
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => {
    const native = window.visualViewport
    window.savedVisualViewport = native
    const synthetic = new EventTarget()
    synthetic.height = 370; synthetic.offsetTop = 0
    Object.defineProperty(window, "visualViewport", { configurable: true, value: synthetic })
    dispatchEvent(new Event("resize"))
  })
  const keyboard = await page.locator("#assistantForm").boundingBox()
  assert.ok(keyboard.y >= 0 && keyboard.y + keyboard.height <= 370)
  assert.equal(await page.locator("#assistantInput").isVisible(), true)
  assert.equal(await page.locator("#assistantSend").isVisible(), true)
  await page.screenshot({ animations: "disabled", path: path.join(screenshotDir, "neurofront-ai-keyboard-mobile.png") })
  await page.evaluate(() => {
    Object.defineProperty(window, "visualViewport", { configurable: true, value: window.savedVisualViewport })
    dispatchEvent(new Event("resize"))
    window.NeuroFrontI18n.selectLanguage?.("ur")
  })
  await page.keyboard.press("Escape")
  await page.locator("#languageButton").click()
  await page.locator("#language-ur").click()
  await page.locator("#assistantLauncher").click()
  assert.equal(await page.locator("#assistantMessages").evaluate(element => getComputedStyle(element).direction), "rtl")
  await page.screenshot({ animations: "disabled", path: path.join(screenshotDir, "neurofront-ai-urdu-mobile.png") })
  await page.emulateMedia({ reducedMotion: "reduce" })
  assert.equal(await page.locator("#assistantPanel").evaluate(element => getComputedStyle(element).animationName), "none")
  await page.keyboard.press("Escape")
  assert.equal(await page.locator("#assistantLauncher").evaluate(element => getComputedStyle(element, "::before").animationName), "none")
  assert.deepEqual(errors, [])
  await browser.close()
  console.log(JSON.stringify({ passed: true, provider: "simulated only", requests, desktop: "1366x768", messageAreaRatio: Number((layout.messagesHeight / layout.panelHeight).toFixed(3)), composerHeight: layout.composerHeight, mobile: ["390x844", "320x740", "844x390"], simulatedKeyboardHeight: 370, reducedMotion: true, screenshotDir, errors }))
})().catch(async error => { console.error(error); console.error(JSON.stringify({ startupErrors })); await browser?.close(); process.exitCode = 1 })
