"use strict"
const assert = require("node:assert/strict")
const { execFileSync } = require("node:child_process")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")

const url = process.env.NEUROFRONT_URL || "http://127.0.0.1:5180"
const base = process.env.NEUROFRONT_COMPARE_BASE
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined })
  try {
    const variants = [["desktop", { width:1366, height:768 }, "no-preference"],
      ["mobile-guest", { width:320, height:740 }, "reduce"]]
    const results = []
    for (const [label, viewport, reducedMotion] of variants) {
      const context = await browser.newContext({ viewport, reducedMotion })
      try {
        const page = await context.newPage(), errors = []
        page.on("pageerror", error => errors.push(error.message))
        const candidate = await profile(page, viewport)
        assert.deepEqual(errors, [])
        assert.equal(candidate.initial.opacity, "1")
        assert.equal(candidate.initial.transform, "none")
        assert.equal(candidate.initial.before, "none")
        assert.equal(candidate.initial.after, "none")
        assert.equal(candidate.initial.attachment, "scroll, scroll, scroll")
        assert.equal(candidate.initial.panelFilter, "none")
        assert.equal(candidate.chartDraws, 0)
        assert.equal(candidate.stableMutations, 0)
        assert.ok(candidate.afterScroll > candidate.startScroll + 100)
        assert.equal(candidate.stationaryPixels, true)
        results.push({ label, candidate })
        if (!base) continue
        const sources = new Map(["styles.css","app.js","dashboard-session.js","index.html"].map(name => [name,
          execFileSync("git", ["show", base + ":" + name], { cwd: __dirname, encoding: "utf8" })]))
        await page.route("**/*", route => {
          const name = new URL(route.request().url()).pathname.slice(1) || "index.html"
          return sources.has(name) ? route.fulfill({ body:sources.get(name), contentType:name.endsWith(".css") ? "text/css" : name.endsWith(".js") ? "text/javascript" : "text/html" }) : route.fallback()
        })
        const previous = await profile(page, viewport)
        assert.ok(previous.chartDraws > 5)
        assert.ok(previous.stableMutations > 20)
        assert.deepEqual(candidate.widths, previous.widths)
        if (label === "desktop") assert.deepEqual(candidate.chartPosition, previous.chartPosition)
        results.at(-1).previous = previous
      } finally { await context.close() }
    }
    console.log(JSON.stringify(results, null, 2))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })

async function profile(page, viewport) {
  await page.goto(url)
  await page.waitForFunction(() => document.body.classList.contains("is-ready") && window.NeuroFrontAccount?.sessionResolved())
  await page.waitForTimeout(850)
  await page.evaluate(() => {
    const refs = ["signalValue","tempValue","gsrValue","stressScore","xAxisStart","xAxisQuarter","xAxisHalf","xAxisEnd"]
    const stats = window.qaFrameStats = { stableMutations:0, chartDraws:0 }
    const observer = new MutationObserver(records => stats.stableMutations += records.length)
    for (const id of refs) observer.observe(document.getElementById(id), { childList:true, attributes:true, subtree:true, characterData:true })
    const original = state.chart.update.bind(state.chart)
    state.chart.update = (...args) => { stats.chartDraws++; return original(...args) }
    stats.startScroll = Math.max(document.scrollingElement.scrollTop,document.body.scrollTop)
    stats.widths = [".app-shell",".dashboard",".chart-panel","#summaryPanel",".history-panel"].map(selector => document.querySelector(selector).getBoundingClientRect().width)
    const chart = document.querySelector(".chart-panel").getBoundingClientRect()
    stats.chartPosition = [chart.x,chart.y,chart.width,chart.height]
    const body = getComputedStyle(document.body)
    stats.initial = { opacity:body.opacity, transform:body.transform, attachment:body.backgroundAttachment,
      before:getComputedStyle(document.body,"::before").content, after:getComputedStyle(document.body,"::after").content,
      panelFilter:getComputedStyle(document.querySelector(".panel")).backdropFilter }
  })
  const clip = { x:1, y:2, width:7, height:10 }
  const first = await page.screenshot({ clip })
  await page.waitForTimeout(160)
  const second = await page.screenshot({ clip })
  await page.mouse.move(viewport.width / 2, viewport.height / 2)
  await page.mouse.wheel(0, 550)
  await page.waitForFunction(() => Math.max(document.scrollingElement.scrollTop,document.body.scrollTop) > 100)
  await page.waitForTimeout(200)
  const stats=await page.evaluate(() => ({ ...qaFrameStats, afterScroll:Math.max(document.scrollingElement.scrollTop,document.body.scrollTop) }))
  return { ...stats, stationaryPixels:first.equals(second) }
}
