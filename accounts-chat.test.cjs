"use strict"
const assert = require("node:assert/strict")
const fs = require("node:fs")
const http = require("node:http")
const path = require("node:path")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")

const fixture = {
  id: "00000000-0000-4000-8000-000000000001", completedAt: "2026-10-31T10:00:15.000Z", durationMs: 15000,
  calculationVersion: "neurofront-stress-v1", unit: "mV", samples: [1, 2, 1],
  stress: { score: 80, label: "High" }, summary: { average: 2, peak: 4, minimum: 1, activityLabel: "Stable" },
  baseline: { createdAt: "2026-10-30T10:00:00.000Z", calculationVersion: "neurofront-stress-v1", unit: "mV", sampleIntervalMs: 50, durationMs: 20000, mean: 1, rms: 1, stdDev: 1, peakToPeak: 2, derivativeMean: 1, samples: [1, 1, 2] }
}
const html = `<!doctype html><html lang="en"><head><style>body{margin:20px}button,textarea{margin:6px;min-height:35px}#assistantPanel{width:400px}#assistantMessages{max-height:270px;overflow:auto}#assistantNotice{padding:10px;min-height:40px}#assistantNotice:has(#assistantStatus:empty){min-height:0}p{margin:6px}</style></head><body>
<button id="assistantLauncher">Assistant</button><button id="getMeasurementExplanation" hidden>Explain</button><button id="captureExplain">Capture</button>
<section id="assistantPanel" hidden><button id="assistantClose">Close</button><button id="assistantNewChat">New</button>
<div id="assistantContext"><span id="assistantContextText"></span><button id="assistantClearContext">Clear</button></div>
<div id="assistantMessages"></div><div id="assistantNotice"><p id="assistantStatus"></p><button id="assistantRetry">Retry</button><button id="assistantNoticeClose">X</button></div>
<form id="assistantForm"><textarea id="assistantInput"></textarea><button type="button" id="assistantStop">Stop</button><button id="assistantSend">Send</button></form></section></body></html>`

;(async () => {
  const server = http.createServer((_request, response) => response.writeHead(200, { "Content-Type": "text/html" }).end(html))
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined })
  const context = await browser.newContext({ viewport: { width: 900, height: 1000 } })
  const page = await context.newPage()
  const errors = [], calls = []
  let mode = "failure", held = null
  page.on("pageerror", error => errors.push(error.message))
  await page.route("**/api/assistant", async route => {
    calls.push({ body: route.request().postDataJSON(), authorization: route.request().headers().authorization })
    if (mode === "held") { held = route; return }
    await route.fulfill({ status: mode === "failure" ? 503 : 200, contentType: "application/json", body: JSON.stringify(mode === "failure" ? { error: { code: "unavailable" } } : { paragraphs: ["A reviewed response."], resourceIds: ["baseline"] }) })
  })
  try {
    await page.goto(`http://127.0.0.1:${server.address().port}`)
    await page.clock.install()
    await page.evaluate(capture => {
      window.NEUROFRONT_TRANSLATIONS = Object.fromEntries(["en", "hi", "mr", "bn", "ta", "te", "kn", "ml", "gu", "pa", "or", "as", "ur"].map(locale => [locale, { "history.notAvailable": "Not available" }]))
      window.NEUROFRONT_RESOURCES = ["getting-started", "baseline", "readings", "placement", "habits"].map(id => ({ id }))
      window.NeuroFrontResources = { open() {} }
      window.fixture = capture
      window.testOwner = null
      window.captureCloudSaved = true
      window.saves = []
      window.NeuroFrontAccount = {
        owner: () => window.testOwner, isCurrent: id => id === window.testOwner,
        getState: () => ({ captures: [capture] }), accessToken: async () => "simulated-token",
        captureSaved: () => window.captureCloudSaved,
        saveThread: async (thread, expectedOwner) => window.saves.push({ thread: structuredClone(thread), expectedOwner })
      }
      window.NeuroFrontHistory = { getLatest: () => capture, readAssistantHistory: async () => ({ previous: [], historyAvailable: true }) }
    }, fixture)
    for (const file of ["score-config.js", "assistant-language.js", "assistant.js"]) await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, file), "utf8") })
    const failed = async () => page.waitForFunction(() => !document.getElementById("assistantSend").disabled && document.querySelector('[data-status="failed"]'))
    await page.evaluate(() => NeuroFrontAssistant.explain(fixture))
    await failed()
    assert.match(await page.locator('[data-kind="preset"]').textContent(), /80\/100/)
    await page.mouse.move(880, 980)
    await page.locator("#assistantInput").focus()
    await page.clock.runFor(3000)
    await page.evaluate(() => document.dispatchEvent(new CustomEvent("neurofront:languagechange")))
    await page.clock.runFor(2001)
    assert.equal(await page.locator("#assistantNoticeClose").isVisible(), false)
    assert.equal(await page.locator("#assistantStatus").textContent(), "")
    assert.equal(await page.locator(".assistant-message-retry").count(), 1)
    assert.match(await page.locator('[data-kind="preset"]').textContent(), /80\/100/)

    await page.locator(".assistant-message-retry").click()
    await failed()
    await page.locator("#assistantInput").focus(); await page.mouse.move(880, 980)
    await page.clock.runFor(2000)
    await page.locator("#assistantNotice").hover()
    await page.clock.runFor(9000)
    assert.equal(await page.locator("#assistantNoticeClose").isVisible(), true)
    await page.mouse.move(880, 980)
    await page.clock.runFor(3001)
    assert.equal(await page.locator("#assistantNoticeClose").isVisible(), false)

    await page.locator(".assistant-message-retry").click(); await failed()
    await page.locator("#assistantRetry").focus(); await page.mouse.move(880, 980)
    await page.clock.runFor(8000)
    assert.equal(await page.locator("#assistantNoticeClose").isVisible(), true)
    await page.locator("#assistantNoticeClose").click()
    assert.equal(await page.locator("#assistantNoticeClose").isVisible(), false)
    assert.equal(await page.locator(".assistant-message-retry").count(), 1)
    await page.evaluate(() => { document.getElementById("assistantInput").value = "x".repeat(1201); document.getElementById("assistantForm").dispatchEvent(new Event("submit", { cancelable: true })) })
    await page.clock.runFor(20000)
    assert.match(await page.locator("#assistantStatus").textContent(), /1200/)

    const guestCalls = calls.length
    await page.evaluate(() => { window.testOwner = "account-a"; captureCloudSaved = false; document.dispatchEvent(new CustomEvent("neurofront:accountreset")); NeuroFrontAssistant.explain(fixture) })
    await failed()
    assert.equal(calls.length, guestCalls)
    assert.match(await page.locator('[data-kind="preset"]').textContent(), /80\/100/)
    await page.evaluate(() => { captureCloudSaved = true })
    await page.locator("#assistantRetry").click(); await failed()
    const authCall = calls.at(-1)
    assert.equal(authCall.body.accountCaptureId, fixture.id)
    assert.equal(authCall.body.context, null)
    assert.equal(authCall.authorization, "Bearer simulated-token")
    const failedSnapshot = await page.evaluate(() => NeuroFrontAssistant.getSnapshot())
    assert.equal(failedSnapshot.messages.at(-1).status, "failed")
    assert.ok(failedSnapshot.messages.some(message => message.kind === "preset" && message.content.includes("80/100")))
    assert.ok(failedSnapshot.messages.every(message => !message.capture && !message.job))
    const failedId = failedSnapshot.messages.at(-1).id
    mode = "success"
    await page.locator("#assistantRetry").click()
    await page.waitForFunction(() => !document.getElementById("assistantSend").disabled && document.querySelector('[data-kind="reply"]'))
    const completedSnapshot = await page.evaluate(() => NeuroFrontAssistant.getSnapshot())
    assert.equal(completedSnapshot.messages.at(-1).id, failedId)
    assert.equal(completedSnapshot.messages.at(-1).status, "completed")
    assert.equal(completedSnapshot.messages.filter(message => message.kind === "preset").length, 1)
    const pending = structuredClone(failedSnapshot)
    pending.messages.at(-1).status = "pending"
    const count = calls.length
    await page.evaluate(thread => document.dispatchEvent(new CustomEvent("neurofront:threadselect", { detail: { thread, captures: [fixture] } })), pending)
    assert.equal(calls.length, count)
    assert.equal((await page.evaluate(() => NeuroFrontAssistant.getSnapshot())).messages.at(-1).status, "failed")
    assert.equal(await page.locator(".assistant-message-retry").count(), 1)

    mode = "held"
    await page.locator(".assistant-message-retry").click()
    await page.waitForFunction(() => document.getElementById("assistantSend").disabled)
    for (let attempt = 0; attempt < 100 && !held; attempt++) await page.waitForTimeout(50)
    assert.ok(held)
    const interruptedThread = await page.evaluate(() => NeuroFrontAssistant.getSnapshot())
    const otherThread = { ...structuredClone(completedSnapshot), id: "00000000-0000-4000-8000-000000000099" }
    await page.evaluate(thread => document.dispatchEvent(new CustomEvent("neurofront:threadselect", { detail: { thread, captures: [fixture] } })), otherThread)
    const interruptedSave = await page.evaluate(id => saves.filter(save => save.thread.id === id).at(-1), interruptedThread.id)
    assert.equal(interruptedSave.thread.messages.at(-1).status, "stopped")
    assert.equal(interruptedSave.thread.messages.at(-1).id, interruptedThread.messages.at(-1).id)
    assert.equal((await page.evaluate(() => NeuroFrontAssistant.getSnapshot())).id, otherThread.id)
    await held.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ paragraphs: ["Reply from the previous thread."], resourceIds: [] }) }).catch(() => {})
    assert.equal(await page.getByText("Reply from the previous thread.").count(), 0)

    held = null
    await page.evaluate(thread => document.dispatchEvent(new CustomEvent("neurofront:threadselect", { detail: { thread, captures: [fixture] } })), pending)
    await page.locator(".assistant-message-retry").click()
    await page.waitForFunction(() => document.getElementById("assistantSend").disabled)
    for (let attempt = 0; attempt < 100 && !held; attempt++) await page.waitForTimeout(50)
    assert.ok(held)
    const savesBefore = await page.evaluate(() => saves.length)
    await page.evaluate(() => { testOwner = "account-b"; document.dispatchEvent(new CustomEvent("neurofront:accountreset")) })
    await held.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ paragraphs: ["Private account A answer."], resourceIds: [] }) }).catch(() => {})
    assert.equal(await page.locator(".assistant-message").count(), 0)
    assert.equal(await page.locator("#assistantPanel").isVisible(), false)
    assert.equal(await page.evaluate(() => saves.length), savesBefore)
    assert.ok((await page.evaluate(() => saves)).every(save => save.expectedOwner === "account-a"))
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ simulatedProviderAndAccounts: true, expiresAfterFiveSecondsAcrossRenders: true, hoverAndFocusPause: true, immediateDismiss: true, persistentMessageRetry: true, validationPersists: true, unsyncedCaptureKeepsPresetWithoutApi: true, authenticatedOwnedIdOnly: true, stableReplyIdsAndStatuses: true, pendingRestoreWithoutNetwork: true, threadSwitchPersistsStoppedAndRejectsStaleReply: true, accountSwitchRejectsStaleResponse: true, errors }, null, 2))
  } finally { await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve)) }
})().catch(error => { console.error(error); process.exitCode = 1 })
