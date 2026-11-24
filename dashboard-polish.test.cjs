const assert = require("node:assert/strict")
const { test } = require("node:test")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")

test("Expo dashboard layout, native named baseline and keyboard calendar", async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined })
  try {
    for (const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:740}]) {
      const page = await browser.newPage({ viewport, reducedMotion: "reduce" })
      const errors = []
      page.on("pageerror", error => errors.push(error.message))
      await page.goto(process.env.NEUROFRONT_URL || "http://127.0.0.1:5180", { waitUntil: "domcontentloaded" })
      await page.waitForFunction(() => window.NeuroFrontHistory && document.body.classList.contains("is-ready") && NeuroFrontAccount.sessionResolved())
      const q = id => page.locator("#" + id)
      await page.evaluate(() => {
        const samples = Array.from({length: BASELINE_SAMPLE_COUNT}, (_, i) => Math.sin(i))
        const baseline = { schemaVersion: 1, calculationVersion: CALCULATION_VERSION, deviceName: DEVICE_NAME,
          serviceUuid: SERVICE_UUID, characteristicUuid: CHAR_UUID, unit: "uV", sampleIntervalMs: SAMPLE_INTERVAL,
          calibrationDurationMs: BASELINE_MS, createdAt: new Date(2026, 10, 24).toISOString(), samples, features: computeSignalFeatures(samples) }
        NeuroFrontDevice.setSavedBaseline(baseline, [{id:"primary",label:"RN primary",payload:baseline}], "primary")
      })
      assert.equal(await q("baselineSelect").inputValue(), "primary")
      assert.equal(await q("baselineSelectedName").isVisible(), true)
      assert.equal(await q("baselineSelectedName").textContent(), "RN primary")
      assert.match(await q("baselineSelect").locator("option:checked").textContent(), /RN primary .+24/)
      assert.equal(await q("adaptiveArchive").evaluate(el=>el.tagName), "SECTION")
      assert.equal(await q("adaptiveArchiveEmpty").isVisible(), true)
      const [count, unit, ring] = await Promise.all([q("countdownValue").boundingBox(), page.locator(".countdown-core small").boundingBox(), page.locator(".countdown-ring").boundingBox()])
      assert.ok(Math.abs((count.x + unit.x + unit.width) / 2 - (ring.x + ring.width / 2)) < 2)
      if(viewport.width === 1440) {
        const heights = await page.locator(".capture-row > section").evaluateAll(els => els.map(el=>el.getBoundingClientRect().height))
        assert.ok(Math.abs(heights[0]-heights[1]) < 2)
      }
      await q("stressPreviewOpen").focus()
      await page.keyboard.press("Enter")
      assert.equal(await q("stressSummaryDialog").evaluate(el=>el.open), true)
      const metrics = await q("stressSummaryDialog").evaluate(dialog => {
        const byId = id => dialog.querySelector("#" + id)
        const left = dialog.querySelector(".stress-summary-main")
        const right = dialog.querySelector(".stress-summary-side")
        const table = left.querySelector("table").getBoundingClientRect()
        const details = byId("stressSummaryDetails").getBoundingClientRect()
        return {below: details.top >= table.bottom, separate: right.contains(byId("stressSummaryDayCard")),
          overflow: dialog.scrollWidth > dialog.clientWidth, equal: Math.abs(left.clientHeight-right.clientHeight) < 2}
      })
      assert.ok(metrics.below && metrics.separate && !metrics.overflow)
      if(viewport.width === 1440) assert.ok(metrics.equal)
      await q("stressSummaryPrevious").click()
      await q("stressSummaryNext").click()
      await page.keyboard.press("Escape")
      await page.waitForFunction(() => document.activeElement.id === "stressPreviewOpen")
      await q("stressPreviewOpen").click()
      assert.equal(await q("stressSummaryDialog").evaluate(el=>el.open), true)
      await q("stressSummaryClose").click()
      await q("modeSelect").selectOption("adaptive")
      assert.equal(await q("adaptiveBaselineAbout").isVisible(), true)
      assert.equal(await q("adaptiveBaselineAbout").evaluate(el=>el.closest("aside").previousElementSibling.classList.contains("stress-baseline-picker")), true)
      assert.equal(await q("adaptiveStart").isDisabled(), true)
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth))
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally { await browser.close() }
})
