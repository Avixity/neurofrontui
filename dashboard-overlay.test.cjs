"use strict"
const assert = require("node:assert/strict")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const url = process.env.NEUROFRONT_URL || "http://127.0.0.1:5180"

;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined })
  try {
    for (const [width, height] of [[1366,768], [390,844], [320,740], [844,390]]) {
      const context = await browser.newContext({ viewport: {width,height}, reducedMotion:"reduce" })
      try {
        const page = await context.newPage()
        const errors = []
        page.on("pageerror", error => errors.push(error.stack || error.message))
        await page.goto(url)
        await page.waitForFunction(() => document.body.classList.contains("is-ready") && window.NeuroFrontResources)
        const dock = page.getByRole("navigation", { name: "Dashboard navigation" })
        const link = name => dock.getByRole("link", { name, exact:true })
        assert.equal(await dock.getByRole("link").count(), 3)
        assert.equal(await dock.getByRole("button").count(), 0)
        assert.equal(await dock.locator(".dock-tooltip:visible").count(), 0)
        const box = await dock.boundingBox()
        const assistant = page.locator("#assistantLauncher")
        assert.equal(await assistant.locator("img").count(), 1)
        const assistantBox = await assistant.boundingBox()
        if (height > 470) assert.ok(assistantBox.y > box.y + box.height)
        assert.equal(await dock.evaluate(el => getComputedStyle(el.parentElement).position), "fixed")
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        await link("Data").focus()
        await link("Data").locator(".dock-tooltip").waitFor({ state:"visible" })
        await page.keyboard.press("Enter")
        assert.equal(await page.evaluate(() => document.activeElement.id), "summaryTitle")
        await link("Educational Resources").click()
        assert.equal(await page.locator("#resourcesToggle").getAttribute("aria-expanded"), "true")
        assert.equal(await page.evaluate(() => document.activeElement.id), "resourcesToggle")
        await link("Measurement").click()
        assert.equal(await page.evaluate(() => document.activeElement.id), "measurementArea")
        await page.locator("#connectButton").click({ trial:true, timeout:7000 })
        await page.locator("#languageButton").click()
        await page.locator("#language-hi").click()
        assert.equal(await page.locator("html").getAttribute("lang"), "hi")
        await page.locator("#languageButton").click()
        await page.locator("#language-en").click()
        const mode = page.getByRole("combobox", { name:"Measurement mode" })
        assert.equal(await mode.inputValue(), "standard")
        assert.deepEqual(await mode.locator("option").evaluateAll(options => options.map(option => option.value)), ["standard","adaptive","adaptive-5","adaptive-10"])
        await assistant.click()
        await page.waitForFunction(() => document.getElementById("assistantPanel").contains(document.activeElement))
        await page.keyboard.press("Escape")
        await page.locator("#assistantPanel").waitFor({ state:"hidden" })
        await page.waitForFunction(() => document.activeElement.id === "assistantLauncher")
        assert.deepEqual(errors, [])
      } finally { await context.close() }
    }
    console.log("Dashboard overlay passed on desktop, two phone widths and landscape.")
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })

