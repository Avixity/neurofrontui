"use strict"
const assert = require("node:assert/strict")
const path = require("node:path")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const url = process.env.NEUROFRONT_URL || "http://127.0.0.1:5180"

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined })
  try {
    for (const viewport of [{width:1366,height:768}, {width:390,height:844}, {width:320,height:740}]) {
      const context = await browser.newContext({ viewport, reducedMotion: "reduce" })
      try {
        const page = await context.newPage()
        const errors = []
        page.setDefaultTimeout(15000)
        page.on("pageerror", err => errors.push(err.message))
        await page.addInitScript(() => {
          const characteristic = new EventTarget(), device = new EventTarget()
          characteristic.startNotifications = async () => characteristic
          device.gatt = {
            connected: false,
            async connect() { this.connected = true; return this },
            disconnect() { this.connected = false; device.dispatchEvent(new Event("gattserverdisconnected")) },
            async getPrimaryService() { return { async getCharacteristic() { return characteristic } } }
          }
          Object.defineProperty(navigator, "bluetooth", { configurable:true, value:{ async requestDevice() { return device } } })
          window.shellBle = { emit(value) {
            characteristic.value = new DataView(new TextEncoder().encode(String(value)).buffer)
            characteristic.dispatchEvent(new Event("characteristicvaluechanged"))
          }, device, freeze() {
            const fixed = performance.now()
            this.frozen = true
            performance.now = () => fixed
            this.emit(1)
            NeuroFrontAdaptive.tick(fixed)
          } }
          const raf = window.requestAnimationFrame.bind(window)
          window.requestAnimationFrame = callback => raf(ts => callback(window.shellBle.frozen ? performance.now() : ts))
        })
        await page.goto(url)
        await page.waitForFunction(() => document.body.classList.contains("is-ready") && window.NeuroFrontAssistant)
        const locator = selector => page.locator(selector)
        const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "Dashboard must not overflow horizontally")
        const usableBaseline = async () => {
          const card = await locator(".stress-card").boundingBox(), select = await locator("#baselineSelect").boundingBox()
          assert.ok(select.width >= Math.min(130, card.width / 2), "Baseline picker keeps enough width for its date or status")
        }
        const screenshot = async label => {
          if (process.env.NEUROFRONT_SCREENSHOT_DIR) await page.screenshot({ fullPage: true, animations: "disabled", path: path.join(process.env.NEUROFRONT_SCREENSHOT_DIR, "dashboard-" + viewport.width + "-" + label + ".png") })
        }
        await noOverflow()
        assert.equal(await locator("#modeSelect").inputValue(), "standard")
        assert.equal(await locator("#baselineSelect").count(), 1)
        assert.equal(await locator("#savedBaselineButton").count(), 0)
        assert.equal(await locator("#countdownValue").textContent(), "15.0")
        const checkTimer = async () => {
          const count = await locator("#countdownValue").boundingBox(), units = await locator(".countdown-core small").boundingBox()
          const ring = await locator(".countdown-ring").boundingBox()
          assert.ok(Math.abs((count.x + count.width / 2) - (ring.x + ring.width / 2)) < 2, "Timer numeral is centered independently of seconds unit")
          assert.ok(Math.abs(units.x - (count.x + count.width)) < 8 && Math.abs(units.y - count.y) < count.height, "Seconds unit sits alongside the numeral")
          assert.ok(units.height < count.height, "Seconds unit is smaller")
        }
        await checkTimer()
        await usableBaseline()
        await screenshot("standard")
        await locator("#languageButton").click()
        await locator("#language-hi").click()
        assert.equal(await page.locator("html").getAttribute("lang"), "hi")
        await locator("#languageButton").click()
        await locator("#language-en").click()
        assert.equal(await page.locator("html").getAttribute("lang"), "en")
        await locator('.dashboard-dock a[href="#summaryTitle"]').click()
        assert.equal(await page.evaluate(() => document.activeElement.id), "summaryTitle")
        await locator('.dashboard-dock a[href="#measurementArea"]').click()
        assert.equal(await page.evaluate(() => document.activeElement.id), "measurementArea")
        await locator("#assistantLauncher").click()
        await locator("#assistantPanel").waitFor({ state:"visible" })
        await page.waitForFunction(() => document.getElementById("assistantPanel").contains(document.activeElement))
        await page.keyboard.press("Escape")
        await locator("#assistantPanel").waitFor({ state:"hidden" })
        assert.equal(await page.evaluate(() => document.activeElement.id), "assistantLauncher")

        await locator("#modeSelect").selectOption("adaptive")
        await locator("#adaptivePanel").waitFor({ state:"visible" })
        assert.equal(await locator(".chart-panel").isVisible(), false)
        assert.equal(await locator("#adaptiveTime").textContent(), "00:00")
        assert.equal(await locator("#adaptiveDuration option").count(), 2)
        assert.ok(await locator("#adaptiveStart").isDisabled())
        await noOverflow()
        await usableBaseline()
        await screenshot("adaptive")

        await locator("#connectButton").click()
        await page.waitForFunction(() => state.characteristic)
        assert.equal(await locator("#adaptiveStop").isVisible(), false)
        await locator("#recalibrateButton").click()
        await locator(".countdown-ring").waitFor({ state:"visible" })
        assert.match(await locator("#countdownValue").textContent(), /^(?:20\.0|19\.[0-9])$/)
        await checkTimer()
        await page.evaluate(() => {
          for (let i = 0; i < 400; i++) shellBle.emit(Math.sin(i / 6) * 10)
          state.calibration.startTime -= 20000
          updateMeasurement(performance.now())
        })
        await page.waitForFunction(() => state.baseline.ready && !state.calibration.active)
        await page.evaluate(() => shellBle.freeze())
        await locator("#adaptiveStart").click()
        await locator("#adaptiveStop").waitFor({ state:"visible" })
        await locator("#adaptiveStop").click()
        assert.match(await locator("#adaptiveStatus").textContent(), /discarded/i)
        assert.ok(await locator("#adaptiveCoverage").isHidden())
        await page.evaluate(() => shellBle.emit(1))
        await locator("#adaptiveStart").click()
        await locator("#adaptiveStop").waitFor({ state:"visible" })
        await page.evaluate(() => shellBle.device.gatt.disconnect())
        await locator("#adaptiveStop").waitFor({ state:"hidden" })
        assert.match(await locator("#adaptiveStatus").textContent(), /interrupted/i)
        assert.ok(await locator("#adaptiveCoverage").isHidden())
        assert.equal(await page.evaluate(() => NeuroFrontHistory.getLatest()), null)

        if (viewport.width === 1366) {
          await locator("#connectButton").click()
          await page.waitForFunction(() => state.characteristic)
          for (const minutes of [5, 10]) {
            await locator("#adaptiveDuration").selectOption(String(minutes))
            const observed = await page.evaluate(minutes => {
              const original = performance.now, start = original.call(performance)
              let simulated = start
              performance.now = () => simulated
              try {
                shellBle.emit(0)
                NeuroFrontAdaptive.tick(simulated)
                document.getElementById("adaptiveStart").click()
                const started = NeuroFrontAdaptive.busy()
                for (let sample = 0; sample < minutes * 1200; sample++) {
                  simulated = start + sample * 50 + 1
                  shellBle.emit(Math.sin(sample / 6) * 10)
                }
                simulated = start + minutes * 60000
                NeuroFrontAdaptive.tick(simulated)
                return { started, busy: NeuroFrontAdaptive.busy(), timer: document.getElementById("adaptiveTime").textContent,
                  coverage: document.getElementById("adaptiveCoverage").textContent, status: document.getElementById("adaptiveStatus").textContent,
                  latest: NeuroFrontHistory.getLatest() }
              } finally { performance.now = original; shellBle.emit(0) }
            }, minutes)
            assert.equal(observed.started, true)
            assert.equal(observed.busy, false)
            assert.equal(observed.timer, String(minutes).padStart(2,"0") + ":00")
            assert.match(observed.coverage, new RegExp("^" + minutes * 4 + " complete"))
            assert.match(observed.status, /^Recorded session estimate: \d+\/100$/)
            assert.equal(observed.latest, null)
          }
          await page.evaluate(() => shellBle.freeze())
          await locator("#adaptiveStart").click()
          await locator("#adaptiveStop").waitFor({ state:"visible" })
          await page.evaluate(() => {
            Object.defineProperty(document, "hidden", { configurable:true, value:true })
            try { document.dispatchEvent(new Event("visibilitychange")) }
            finally { delete document.hidden }
          })
          await locator("#adaptiveStop").waitFor({ state:"hidden" })
          assert.match(await locator("#adaptiveStatus").textContent(), /tab hidden/i)
          assert.equal(await locator("#adaptiveCoverage").isVisible(), false)
        }
        await locator("#modeSelect").selectOption("standard")
        await checkTimer()
        assert.deepEqual(errors, [])
      } finally { await context.close() }
    }
    console.log("Synthetic dashboard shell passed at desktop, phone, and narrow-phone widths.")
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
