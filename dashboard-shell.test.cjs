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
          assert.ok(Math.abs((count.x + (units.x + units.width - count.x) / 2) - (ring.x + ring.width / 2)) < 2, "Timer numeral and seconds unit are centered together")
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
        assert.deepEqual(await locator("#modeSelect option").evaluateAll(options => options.map(option => option.value)), ["standard","adaptive"])
        assert.deepEqual(await locator("#adaptiveDuration option").evaluateAll(options => options.map(option=>option.value)),["unlimited","5","10","custom"])
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
        assert.match(await locator("#adaptiveStatus").textContent(), /You stopped.*Nothing was saved.*15 seconds/i)
        assert.equal(await locator("#adaptiveStatus").getAttribute("role"),"status")
        assert.ok(await locator("#adaptiveCoverage").isHidden())
        await page.evaluate(() => shellBle.emit(1))
        await locator("#adaptiveStart").click()
        await locator("#adaptiveStop").waitFor({ state:"visible" })
        await page.evaluate(() => shellBle.device.gatt.disconnect())
        await locator("#adaptiveStop").waitFor({ state:"hidden" })
        const disconnectNote = await locator("#adaptiveStatus").textContent()
        assert.match(disconnectNote, /Bluetooth disconnected.*Nothing was saved.*Reconnect/i)
        await page.evaluate(() => NeuroFrontI18n.select("hi",false))
        assert.notEqual(await locator("#adaptiveStatus").textContent(),disconnectNote)
        assert.doesNotMatch(await locator("#adaptiveStatus").textContent(),/dash\.discardDisconnected/)
        await page.evaluate(() => NeuroFrontI18n.select("en",false))
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
            assert.match(observed.coverage, new RegExp("^" + minutes * 4 + " full"))
            assert.match(observed.status, /^Recorded session estimate: \d+\/100$/)
            assert.equal(observed.latest, null)
          }
          await locator("#adaptiveDuration").selectOption("unlimited")
          const unlimited = await page.evaluate(() => {
            const original = performance.now, start = original.call(performance)
            let simulated = start
            performance.now = () => simulated
            try {
              shellBle.emit(0)
              NeuroFrontAdaptive.tick(simulated)
              document.getElementById("adaptiveStart").click()
              for (let sample = 0; sample < 12211; sample++) {
                simulated = start + sample * 50 + 1
                shellBle.emit(Math.sin(sample / 6) * 10)
              }
              const running = NeuroFrontAdaptive.busy()
              document.getElementById("adaptiveStop").click()
              return { running, busy: NeuroFrontAdaptive.busy(), timer: document.getElementById("adaptiveTime").textContent,
                rows: JSON.parse(localStorage.getItem("neurofront.adaptiveHistory.v1.guest")) }
            } finally { performance.now = original; shellBle.emit(0) }
          })
          assert.equal(unlimited.running,true)
          assert.equal(unlimited.busy,false)
          assert.equal(unlimited.timer,"10:10")
          assert.equal(unlimited.rows.length,3)
          assert.deepEqual(unlimited.rows.map(({type,presetMs,end,count}) => [type,presetMs,end,count]), [["adaptive",0,"manual",40],["adaptive",600000,"timer",40],["adaptive",300000,"timer",20]])
          assert.ok(unlimited.rows.every(row => Object.keys(row).sort().join(",") === "completedAt,count,durationMs,end,presetMs,score,type"))
          await locator("#adaptiveDuration").selectOption("custom")
          const custom=locator("#adaptiveCustomMinutes")
          for(const invalid of ["","0","61","1.5","1e1"]){
            await custom.fill(invalid)
            assert.equal(await custom.getAttribute("aria-invalid"),"true")
            assert.ok(await locator("#adaptiveStart").isDisabled())
          }
          await custom.fill("1")
          assert.equal(await custom.getAttribute("aria-invalid"),"false")
          const observedCustom=await page.evaluate(() => {
            const original = performance.now, start = original.call(performance)
            let simulated = start
            performance.now = () => simulated
            try {
              shellBle.emit(0)
              NeuroFrontAdaptive.tick(simulated)
              document.getElementById("adaptiveStart").click()
              const settings=document.getElementById("adaptiveDuration"),input=document.getElementById("adaptiveCustomMinutes")
              const locked=settings.disabled&&input.disabled
              input.value="60"; input.dispatchEvent(new Event("input"))
              const frozen=input.value
              for(let sample=0; sample<1200; sample++){
                simulated=start+sample*50+1
                shellBle.emit(Math.sin(sample/6)*10)
              }
              simulated=start+60000
              NeuroFrontAdaptive.tick(simulated)
              return {locked,frozen,busy:NeuroFrontAdaptive.busy(),latest:JSON.parse(localStorage.getItem("neurofront.adaptiveHistory.v1.guest"))[0]}
            } finally { performance.now = original; shellBle.emit(0) }
          })
          assert.equal(observedCustom.locked,true)
          assert.equal(observedCustom.frozen,"1")
          assert.equal(observedCustom.busy,false)
          assert.equal(observedCustom.latest.custom,true)
          assert.equal(observedCustom.latest.durationMs,60000)
          assert.equal(observedCustom.latest.count,4)
          assert.equal(observedCustom.latest.end,"timer")
          await page.evaluate(() => shellBle.freeze())
          await locator("#adaptiveStart").click()
          await locator("#adaptiveStop").waitFor({ state:"visible" })
          await page.evaluate(() => {
            Object.defineProperty(document, "hidden", { configurable:true, value:true })
            try { document.dispatchEvent(new Event("visibilitychange")) }
            finally { delete document.hidden }
          })
          await locator("#adaptiveStop").waitFor({ state:"hidden" })
          assert.match(await locator("#adaptiveStatus").textContent(), /dashboard was hidden.*Nothing was saved.*tab visible/i)
          await page.evaluate(() => shellBle.freeze())
          await locator("#adaptiveStart").click()
          await page.evaluate(() => NeuroFrontDevice.resetForAccount())
          assert.equal(await locator("#adaptivePanel").isVisible(),true)
          assert.match(await locator("#adaptiveStatus").textContent(),/account changed.*Nothing was saved.*Choose a baseline/i)
          assert.equal(await locator("#adaptiveDuration").inputValue(),"unlimited")
          assert.equal(await locator("#adaptiveTime").textContent(),"00:00")
          assert.equal(await locator("#adaptiveCoverage").isVisible(), false)
          await page.reload()
          await page.waitForFunction(() => NeuroFrontAccount.sessionResolved())
          assert.ok(await locator("#adaptiveArchiveTitle").isVisible(), "Adaptive archive does not need expanding")
          assert.equal(await locator("#adaptiveArchiveList li").count(),4)
          assert.match(await locator("#adaptiveArchiveList li").first().textContent(), /01:00 elapsed.*Custom.*1 min/)
          assert.match(await locator("#adaptiveArchiveList li").nth(1).textContent(), /10:10 elapsed.*Unlimited.*Ended by you/)
          const isolation = await page.evaluate(() => {
            const account = window.NeuroFrontAccount, records = document.getElementById("adaptiveArchiveList")
            let id = "qa-account-a"
            window.NeuroFrontAccount = { owner: () => id, sessionResolved: () => true, getState: () => id ? {user:{id}, captures:[]} : {user:null,captures:[]} }
            const dispatch = () => document.dispatchEvent(new CustomEvent("neurofront:accountreset", {detail:{nextOwner:id}}))
            try {
              dispatch()
              const emptyAtSignIn = records.children.length
              const saved = NeuroFrontAdaptiveHistory.save({ type:"adaptive", completedAt:Date.now(), durationMs:15000, presetMs:0, end:"manual", count:1, score:7, samples:[8], baseline:[9] }, id)
              const signedIn = records.children.length
              const stored = JSON.parse(localStorage.getItem("neurofront.adaptiveHistory.v1.owner.qa-account-a"))
              id = "qa-account-b"
              dispatch()
              const otherAccount = records.children.length
              id = null
              dispatch()
              return { emptyAtSignIn, saved, signedIn, otherAccount, guest:records.children.length, closed:!document.getElementById("adaptiveArchive").open, stored }
            } finally { window.NeuroFrontAccount = account }
          })
          assert.deepEqual({...isolation,stored:undefined},{emptyAtSignIn:0,saved:true,signedIn:1,otherAccount:0,guest:4,closed:true,stored:undefined})
          assert.equal(Object.keys(isolation.stored[0]).sort().join(","),"completedAt,count,durationMs,end,presetMs,score,type")
        }
        await locator("#modeSelect").selectOption("standard")
        await checkTimer()
        assert.deepEqual(errors, [])
      } finally { await context.close() }
    }
    console.log("Synthetic dashboard shell passed at desktop, phone, and narrow-phone widths.")
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
