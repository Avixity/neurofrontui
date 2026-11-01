const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const url = process.env.NEUROFRONT_URL || 'http://127.0.0.1:5180'
const launch = { headless: true }
if (process.env.CHROMIUM_PATH) launch.executablePath = process.env.CHROMIUM_PATH

;(async () => {
 const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'neurofront-capture-test-'))
 let context
 const results = { simulatedBluetoothAndTime: true, errors: [] }
 try {
  context = await chromium.launchPersistentContext(profile, { ...launch, viewport: { width: 1366, height: 768 }, acceptDownloads: true })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', error => results.errors.push(error.message))
  await page.addInitScript(() => {
   const calls = { discovery: 0, notifications: 0 }, characteristic = new EventTarget(), device = new EventTarget()
   characteristic.startNotifications = async () => { calls.notifications++; return characteristic }
   device.gatt = { connected: false, async connect() { this.connected = true; return this }, disconnect() { this.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')) }, async getPrimaryService() { return { async getCharacteristic() { return characteristic } } } }
   Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { async requestDevice() { calls.discovery++; return device } } })
   window.sim = { calls, device, emit(value) { characteristic.value = new DataView(new TextEncoder().encode(`${value},36.5,4.1\0`).buffer); characteristic.dispatchEvent(new Event('characteristicvaluechanged')) } }
  })
  async function load() { await page.goto(url); await page.waitForFunction(() => window.NeuroFrontHistory && document.body.classList.contains('is-ready')); await page.waitForFunction(() => !document.getElementById('historyLoadMore').disabled) }
  async function dbRecords() { return page.evaluate(() => new Promise((resolve, reject) => { const request = indexedDB.open('neurofront-captures', 1); request.onsuccess = () => { const db = request.result, get = db.transaction('captures').objectStore('captures').getAll(); get.onsuccess = () => { resolve(get.result); db.close() }; get.onerror = () => reject(get.error) } })) }
  async function count(expected) { await page.waitForFunction(expected => new Promise(resolve => { const request = indexedDB.open('neurofront-captures'); request.onsuccess = () => { const db = request.result, get = db.transaction('captures').objectStore('captures').count(); get.onsuccess = () => { resolve(get.result === expected); db.close() } } }), expected) }
  async function choose(code) { await page.locator('#languageButton').click(); await page.locator('#language-' + code).click() }
  async function connect() { await page.locator('#connectButton').click(); await page.waitForFunction(() => Boolean(state.characteristic)) }
  async function calibrate(scale = 1) { await page.locator('#recalibrateButton').click(); await page.evaluate(scale => { for (let i = 0; i < 400; i++) sim.emit(scale * (Math.sin(i / 5) * 12 + Math.cos(i / 2) * 2)); state.calibration.startTime -= 20000; updateMeasurement(performance.now()) }, scale); assert.equal(await page.evaluate(() => state.flow), 'ready') }
  async function begin() { await page.locator('#measureButton').click(); assert.equal(await page.evaluate(() => state.measurement.active), false); await page.locator('#beginMeasurementButton').click() }
  async function finish(scale = 1) { return page.evaluate(scale => { for (let i = 0; i < 300; i++) { const value = scale * (Math.sin(i / 7) * 13 + Math.cos(i / 3) * 3); sim.emit(value); pushSignalSample(value); updateAxisLabels() } state.measurement.startTime -= 15000; updateMeasurement(performance.now()); return { id: state.measurement.id, score: state.stress.score, category: state.stress.label, summary: JSON.parse(JSON.stringify(state.summary)), samples: state.exportSnapshot.buffer.slice(), baseline: JSON.parse(JSON.stringify(state.measurement.baseline)) } }, scale) }
  await load()
  assert.ok(await page.locator('#historyEmpty').isVisible())
  assert.ok(await page.locator('#summaryEmpty').isVisible())
  const width = await page.evaluate(() => [document.getElementById('connectButton').getBoundingClientRect().width, document.querySelector('.session-action-area').getBoundingClientRect().width])
  assert.equal(width[0], width[1])
  await connect(); await calibrate(); await begin(); const first = await finish(1)
  await count(1)
  const storedFirst = (await dbRecords())[0]
  assert.equal(storedFirst.stress.score, first.score)
  assert.deepEqual(storedFirst.samples, first.samples)
  assert.deepEqual(storedFirst.baseline.samples, first.baseline.samples)
  assert.deepEqual(storedFirst.summary, first.summary)
  if (process.env.NEUROFRONT_SCREENSHOT_DIR) {
   await page.locator('.capture-row').scrollIntoViewIfNeeded()
   await page.screenshot({ path: path.join(process.env.NEUROFRONT_SCREENSHOT_DIR, 'neurofront-history-desktop.png') })
  }
  await page.evaluate(() => { finalizeMeasurement(); finalizeMeasurement() }); await count(1)
  await page.locator('#measureAgainButton').click(); await calibrate(3); await begin(); await finish(4); await count(2)
  assert.deepEqual((await dbRecords()).find(item => item.id === first.id), storedFirst)
  await page.locator(`[data-capture-id="${first.id}"]`).click()
  assert.equal(await page.locator('#captureScore').textContent(), `${Math.round(first.score)}/100`)
  assert.equal(await page.locator('#captureAverage').textContent(), first.summary.average.toFixed(1))
  assert.equal(await page.locator('#captureCategory').textContent(), first.category)
  const oldPath = await page.locator('#captureGraph path').getAttribute('d')
  assert.ok(oldPath.length > 1000)
  if (process.env.NEUROFRONT_SCREENSHOT_DIR) await page.screenshot({ path: path.join(process.env.NEUROFRONT_SCREENSHOT_DIR, 'neurofront-history-details.png') })
  for (let index = 0; index < 8; index++) {
   await page.keyboard.press('Tab')
   assert.ok(await page.evaluate(() => document.getElementById('captureDialog').contains(document.activeElement)))
  }
  await page.evaluate(() => { const original = drawExportChart; drawExportChart = (...args) => { window.exportedCapture = { samples: args[3].slice(), axisMin: args[4], axisMax: args[5], labels: args[6] }; return original(...args) } })
  const downloadPromise = page.waitForEvent('download'); await page.locator('#captureExport').click(); const download = await downloadPromise
  assert.equal(fs.readFileSync(await download.path()).subarray(1, 4).toString(), 'PNG')
  if (process.env.NEUROFRONT_SCREENSHOT_DIR) await download.saveAs(path.join(process.env.NEUROFRONT_SCREENSHOT_DIR, 'neurofront-history-export.png'))
  assert.deepEqual(await page.evaluate(() => exportedCapture.samples), first.samples)
  assert.equal(await page.evaluate(() => exportedCapture.axisMin), storedFirst.axisMin)
  await page.keyboard.press('Escape')
  assert.equal(await page.evaluate(() => document.activeElement.dataset.captureId), first.id)
  // Reading an old capture during acquisition must not touch the current graph or timer.
  await page.locator('#measureAgainButton').click(); await page.locator('#savedBaselineButton').click(); await begin()
  const activeBefore = await page.evaluate(() => ({ start: state.measurement.startTime, id: state.measurement.id, baseline: JSON.stringify(state.measurement.baseline) }))
  await page.locator(`[data-capture-id="${first.id}"]`).click()
  await page.evaluate(() => { sim.emit(10); pushSignalSample(10) })
  assert.equal(await page.locator('#captureGraph path').getAttribute('d'), oldPath)
  assert.deepEqual(await page.evaluate(() => ({ start: state.measurement.startTime, id: state.measurement.id, baseline: JSON.stringify(state.measurement.baseline) })), activeBefore)
  assert.equal(await page.evaluate(() => state.measurement.active), true)
  await page.keyboard.press('Escape'); await page.evaluate(() => sim.device.gatt.disconnect()); await count(2)
  await connect(); await page.locator('#savedBaselineButton').click(); await begin()
  await page.evaluate(() => { state.measurement.samples = []; state.measurement.startTime -= 15000; updateMeasurement(performance.now()) }); await count(2)
  // Generate six additional complete captures through the same app completion hook.
  for (let i = 0; i < 6; i++) { if (await page.evaluate(() => state.flow === 'complete')) { await page.locator('#measureAgainButton').click(); await page.locator('#savedBaselineButton').click() } await begin(); await finish(i + 1); await count(i + 3) }
  await page.waitForFunction(() => document.querySelectorAll('#historyList li').length === 6)
  assert.ok(await page.locator('#historyLoadMore').isVisible())
  await page.locator('#historyLoadMore').click(); await page.waitForFunction(() => document.querySelectorAll('#historyList li').length === 8)
  assert.equal(await page.locator('#historyLoadMore').isVisible(), false)
  await load(); await count(8); assert.equal(await page.locator('#historyList li').count(), 6)
  await page.locator('#historyLoadMore').click(); await page.locator(`[data-capture-id="${first.id}"]`).click()
  assert.equal(await page.locator('#captureGraph path').getAttribute('d'), oldPath)
  await page.keyboard.press('Escape')
  // Abort writes to exercise real IndexedDB save failure and idempotent retries.
  await connect(); await page.locator('#savedBaselineButton').click(); await begin()
  await page.evaluate(() => { window.originalCapturePut = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function(...args) { if (this.name === 'captures') throw new DOMException('Simulated quota failure', 'QuotaExceededError'); return originalCapturePut.apply(this, args) } })
  const failed = await finish(2)
  await page.waitForFunction(() => !document.getElementById('historyRetry').hidden)
  await count(8)
  assert.match(await page.locator('#historyStatus').textContent(), /could not be saved/)
  assert.equal(await page.evaluate(() => state.measurement.completed), true)
  await page.locator(`[data-capture-id="${failed.id}"]`).click(); assert.equal(await page.locator('#captureScore').textContent(), `${Math.round(failed.score)}/100`); await page.keyboard.press('Escape')
  await page.evaluate(() => { IDBObjectStore.prototype.put = originalCapturePut })
  await page.locator('#historyRetry').click(); await count(9)
  await page.evaluate(() => NeuroFrontHistory.record({ ...window.unused })) // Invalid records cannot corrupt history.
  await count(9)
  for (const code of ['en', 'hi', 'mr', 'bn', 'ta', 'te', 'kn', 'ml', 'gu', 'pa', 'or', 'as', 'ur']) {
   await choose(code)
   assert.equal(await page.locator('#historyTitle').textContent(), await page.evaluate(code => NEUROFRONT_TRANSLATIONS[code]['history.title'], code))
   assert.equal(await page.locator('.resource-card').count(), 6)
   if (await page.locator('#resourcesToggle').getAttribute('aria-expanded') === 'false') await page.locator('#resourcesToggle').click()
   await page.locator('.resource-read-more').first().click()
   assert.ok(await page.locator('#resourceDialogBody').textContent())
   assert.equal(await page.locator('#resourceDialogTitle').textContent(), await page.evaluate(code => NEUROFRONT_TRANSLATIONS[code]['resources.getting-started.title'], code))
   await page.keyboard.press('Escape')
  }
  for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
   await page.setViewportSize(viewport)
   assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
   await page.locator('#historyList button').first().click()
   assert.ok(await page.evaluate(() => { const r = document.getElementById('captureDialog').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth }))
   if (process.env.NEUROFRONT_SCREENSHOT_DIR && viewport.width === 390) await page.screenshot({ path: path.join(process.env.NEUROFRONT_SCREENSHOT_DIR, 'neurofront-history-mobile.png') })
   assert.ok(await page.locator('#captureExport').isVisible()); await page.keyboard.press('Escape')
  }
  await choose('en'); await load(); await count(9)
  assert.deepEqual((await dbRecords()).find(item => item.id === first.id), storedFirst)
  const recoveryPage = await context.newPage()
  recoveryPage.on('pageerror', error => results.errors.push(error.message))
  await recoveryPage.addInitScript(() => {
   const original = IDBIndex.prototype.openCursor
   window.failHistoryRead = true
   IDBIndex.prototype.openCursor = function(...args) {
    if (window.failHistoryRead) throw new DOMException('Simulated read failure', 'UnknownError')
    return original.apply(this, args)
   }
  })
  await recoveryPage.goto(url)
  await recoveryPage.waitForFunction(() => !document.getElementById('historyRetry').hidden)
  assert.match(await recoveryPage.locator('#historyStatus').textContent(), /could not be loaded/)
  assert.equal(await recoveryPage.evaluate(() => state.flow), 'baseline')
  await recoveryPage.evaluate(() => { window.failHistoryRead = false })
  await recoveryPage.locator('#historyRetry').click()
  await recoveryPage.waitForFunction(() => document.querySelectorAll('#historyList li').length === 6)
  assert.equal(await recoveryPage.locator('#historyStatus').textContent(), '')
  await recoveryPage.close()
  assert.deepEqual(results.errors, [])
  await context.close()
  context = await chromium.launchPersistentContext(profile, { ...launch, viewport: { width: 1366, height: 768 } })
  const restoredPage = await context.newPage()
  await restoredPage.goto(url)
  await restoredPage.waitForFunction(() => document.querySelectorAll('#historyList li').length === 6)
  const restored = await restoredPage.evaluate(id => new Promise(resolve => {
   const request = indexedDB.open('neurofront-captures')
   request.onsuccess = () => {
    const db = request.result, query = db.transaction('captures').objectStore('captures').get(id)
    query.onsuccess = () => { resolve(query.result); db.close() }
   }
  }), first.id)
  assert.deepEqual(restored, storedFirst)
  Object.assign(results, { completedCaptures: 9, duplicatesPrevented: true, refreshPersistence: true, browserRestartPersistence: true, keyboardFocusTrap: true, oldSnapshotAndExport: true, historyDuringMeasurement: true, incompleteCaptureExcluded: true, failedSaveRetry: true, failedReadRetry: true, pagination: true, languages: 13, desktopMobileLayouts: true })
  console.log(JSON.stringify(results, null, 2))
 } finally {
  await context?.close()
  const expectedPrefix = path.join(path.resolve(os.tmpdir()), 'neurofront-capture-test-')
  if (!path.resolve(profile).startsWith(expectedPrefix)) throw new Error('Unexpected test profile path')
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
 }
})().catch(error => { console.error(error); process.exitCode = 1 })
