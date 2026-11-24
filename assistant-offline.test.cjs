"use strict"

const assert = require("node:assert/strict")
const { once } = require("node:events")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const { createServer } = require("./local-server.cjs")

;(async () => {
  const server = createServer()
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ locale: "en-US" })
    const page = await context.newPage()
    const errors = []
    page.on("pageerror", error => errors.push(error.message))
    await page.route("**/api/account-config", route => route.fulfill({ status: 503, json: { error: { code: "not_configured" } } }))
    let mode = "unavailable", calls = 0
    await page.route("**/api/assistant", route => {
      calls++
      if (mode === "unavailable") return route.fulfill({ status: 503, json: { error: { code: "unavailable" } } })
      if (mode === "unsafe") return route.fulfill({ status: 422, json: { error: { code: "unsafe_request" } } })
      if (mode === "forbidden") return route.fulfill({ status: 403, json: { error: { code: "forbidden" } } })
      return route.fulfill({ status: 200, json: { paragraphs: ["Live answer for the test."], resourceIds: ["baseline"] } })
    })
    await page.goto("http://127.0.0.1:" + server.address().port + "/", { waitUntil: "domcontentloaded" })
    await page.locator("#assistantLauncher").click()
    async function ask(question, status = "completed") {
      await page.locator("#assistantInput").fill(question)
      await page.locator("#assistantSend").click()
      const answer = page.locator('#assistantMessages [data-role=assistant]').last()
      await answer.locator("xpath=self::*[@data-status='" + status + "']").waitFor()
      return answer
    }
    for (const [question, expected] of [
      ["What is a baseline in NeuroFront?", /resting reference/],
      ["How do I start a measurement?", /Begin Measurement/],
      ["What is an Adaptive session?", /enough usable data/],
      ["How do I open Stress Summary?", /scores from saved captures/],
      ["Where can I find my saved captures?", /Capture History/],
      ["How do I connect my NeuroFront headband?", /Bluetooth picker/]
    ]) {
      const answer = await ask(question)
      assert.match(await answer.innerText(), /^Offline guide:/)
      assert.match(await answer.innerText(), expected)
      assert.equal(await answer.locator(".assistant-resource-link").count(), 1)
    }
    for (const question of ["What does my score mean?", "What is a baseline for chest pain?", "What is the weather?"]) {
      const answer = await ask(question, "failed")
      assert.doesNotMatch(await answer.innerText(), /Offline guide:/)
      assert.ok(await answer.locator(".assistant-message-retry").isVisible())
      assert.ok(await answer.locator(".assistant-resource-link").isVisible())
    }
    mode = "unsafe"
    assert.equal(await (await ask("What is a baseline?")).getAttribute("data-kind"), "safety")
    mode = "forbidden"
    assert.ok(await (await ask("What is a baseline?", "failed")).locator(".assistant-message-retry").isVisible())
    mode = "success"
    assert.match(await (await ask("What is a baseline?")).innerText(), /^Live answer for the test\./)
    await page.unroute("**/api/assistant")
    const onlineCalls = calls
    await context.setOffline(true)
    assert.match(await (await ask("How do I open Stress Summary?")).innerText(), /^Offline guide:/)
    assert.equal(calls, onlineCalls)
    assert.deepEqual(errors, [])
    console.log("Assistant FAQ: six app topics, personal/medical/general exclusions, safety refusal, permission failure, online success and actual offline context passed.")
  } finally {
    await browser?.close()
    server.close()
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
