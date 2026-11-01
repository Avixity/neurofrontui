const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')
const { validateRequest } = require('./assistant-server.cjs')
const url = process.env.NEUROFRONT_URL || 'http://127.0.0.1:5180'
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined })
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const page = await context.newPage()
  const errors = [], requests = []
  let mode = 'offline', delayed = null
  page.on('pageerror', error => errors.push(error.message))
  page.setDefaultTimeout(15000)
  try {
    await page.addInitScript(() => {
      const characteristic = new EventTarget(), device = new EventTarget()
      const calls = { discovery: 0, notifications: 0 }
      characteristic.startNotifications = async () => { calls.notifications++; return characteristic }
      device.gatt = { connected: false, async connect() { this.connected = true; return this }, disconnect() { this.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')) }, async getPrimaryService() { return { async getCharacteristic() { return characteristic } } } }
      Object.defineProperty(navigator, 'bluetooth', { value: { async requestDevice() { calls.discovery++; return device } } })
      window.sim = { calls, emit(value) { characteristic.value = new DataView(new TextEncoder().encode(`${value},36.5,4.1`).buffer); characteristic.dispatchEvent(new Event('characteristicvaluechanged')) } }
    })
    await page.route('**/api/assistant', async route => {
      const body = route.request().postDataJSON()
      validateRequest(body)
      requests.push(body)
      if (mode === 'offline') return route.continue()
      if (mode === 'delayed') { delayed = route; return }
      if (mode === 'malicious') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ paragraphs: ['<img src=x onerror=alert(1)>'], resourceIds: [] }) })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ paragraphs: ['Review the saved baseline and repeat under consistent conditions.'], resourceIds: ['baseline'] }) })
    })
    await page.goto(url)
    await page.waitForFunction(() => window.NeuroFrontAssistant && document.body.classList.contains('is-ready'))
    assert.equal(await page.locator('#getMeasurementExplanation').isVisible(), false)
    assert.equal(await page.locator('#resourcesToggle').getAttribute('aria-expanded'), 'false')
    await page.locator('#connectButton').click()
    await page.waitForFunction(() => state.characteristic)
    await page.locator('#recalibrateButton').click()
    await page.evaluate(() => {
      for (let i = 0; i < 400; i++) sim.emit(Math.sin(i / 5) * 12 + Math.cos(i / 2) * 2)
      state.calibration.startTime -= 20000
      updateMeasurement(performance.now())
      state.baseline.createdAt = state.savedBaseline.createdAt = new Date(Date.now() - 10 * 86400000).toISOString()
    })
    async function begin() { await page.locator('#measureButton').click(); assert.equal(await page.evaluate(() => state.measurement.active), false); await page.locator('#beginMeasurementButton').click() }
    async function finish() { return page.evaluate(() => { for (let i = 0; i < 300; i++) { const value = Math.sin(i / 7) * 20 + Math.cos(i / 3) * 3; sim.emit(value); pushSignalSample(value); updateAxisLabels() } state.measurement.startTime -= 15000; updateMeasurement(performance.now()); return NeuroFrontHistory.getLatest() }) }
    await begin()
    const first = await finish()
    assert.equal(requests.length, 0)
    assert.equal(await page.locator('#assistantPanel').isVisible(), false)
    await page.evaluate(first => {
      for (let index = 1; index <= 3; index++) {
        const capture = structuredClone(first)
        capture.id = `simulated-prior-${index}`
        capture.completedAt = new Date(Date.now() - index * 86400000).toISOString()
        capture.startedAt = new Date(Date.parse(capture.completedAt) - 15000).toISOString()
        capture.stress.score = index * 20
        capture.stress.label = NeuroFrontScore.classify(capture.stress.score).label
        if (index === 3) capture.baseline.createdAt = new Date(Date.now() - 9 * 86400000).toISOString()
        NeuroFrontHistory.record(capture)
      }
    }, first)
    await page.locator('#measureAgainButton').click()
    await page.locator('#savedBaselineButton').click()
    await begin()
    const latest = await finish()
    await page.locator('#getMeasurementExplanation').click()
    await page.waitForFunction(() => !document.getElementById('assistantRetry').hidden)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].context.selected.id, latest.id)
    assert.equal(requests[0].context.selected.score, latest.stress.score)
    assert.equal(requests[0].context.previous.some(item => item.id === latest.id), false)
    assert.ok(requests[0].context.previous.some(item => item.id === first.id))
    assert.ok(!JSON.stringify(requests[0]).includes('samples'))
    const preset = await page.locator('[data-kind="preset"]').textContent()
    assert.ok(preset.includes(`${Math.round(latest.stress.score)}/100`))
    assert.match(await page.locator('[data-kind="comparison"]').textContent(), /3 comparable previous captures/)
    assert.equal(await page.locator('[data-kind="explain"]').count(), 1)
    await page.locator('#assistantRetry').click()
    await page.waitForFunction(() => !document.getElementById('assistantRetry').hidden)
    assert.equal(requests.length, 2)
    assert.equal(await page.locator('[data-kind="preset"]').count(), 1)
    assert.equal(await page.locator('[data-kind="explain"]').count(), 1)
    assert.deepEqual(requests[0], requests[1])
    mode = 'success'
    await page.locator('#assistantRetry').click()
    await page.waitForFunction(() => !document.getElementById('assistantSend').disabled)
    assert.equal(await page.locator('#assistantRetry').isVisible(), false)
    await page.locator('.assistant-message .assistant-resource-link').last().click()
    assert.equal(await page.locator('#resourcesToggle').getAttribute('aria-expanded'), 'true')
    assert.ok(await page.locator('#resourceDialog').isVisible())
    await page.keyboard.press('Escape')
    await page.locator('#assistantInput').fill('How should I compare these graphs?')
    await page.locator('#assistantSend').click()
    await page.waitForFunction(() => !document.getElementById('assistantSend').disabled)
    assert.equal(requests.at(-1).context.selected.id, latest.id)
    assert.ok(requests.at(-1).messages.some(message => message.role === 'assistant'))
    assert.equal(requests.at(-1).messages.at(-1).content, 'How should I compare these graphs?')
    await page.locator('#assistantClose').click()
    await page.locator(`[data-capture-id="${first.id}"]`).click()
    await page.locator('#captureExplain').click()
    await page.waitForFunction(() => !document.getElementById('assistantSend').disabled)
    assert.equal(requests.at(-1).context.selected.id, first.id)
    assert.equal(requests.at(-1).context.selected.baseline.createdAt, first.baseline.createdAt)
    // Chat stays independent from the actual acquisition state and sample buffer.
    await page.locator('#assistantClose').click()
    await page.locator('#measureAgainButton').click(); await page.locator('#savedBaselineButton').click(); await begin()
    const active = await page.evaluate(() => ({ start: state.measurement.startTime, id: state.measurement.id, baseline: JSON.stringify(state.measurement.baseline), calls: { ...sim.calls } }))
    await page.locator('#assistantLauncher').click()
    await page.locator('#assistantInput').fill('Why might a trace be noisy?')
    await page.locator('#assistantSend').click()
    await page.evaluate(() => { sim.emit(8); pushSignalSample(8) })
    assert.deepEqual(await page.evaluate(() => ({ start: state.measurement.startTime, id: state.measurement.id, baseline: JSON.stringify(state.measurement.baseline), calls: { ...sim.calls } })), active)
    assert.equal(await page.evaluate(() => state.measurement.active), true)
    await page.waitForFunction(() => !document.getElementById('assistantSend').disabled)
    mode = 'delayed'
    await page.locator('#assistantInput').fill('Explain my baseline')
    await page.locator('#assistantSend').click()
    await page.waitForTimeout(150)
    assert.ok(delayed)
    const before = requests.length
    await page.evaluate(() => { NeuroFrontAssistant.explain(NeuroFrontHistory.getLatest()); NeuroFrontAssistant.explain(NeuroFrontHistory.getLatest()) })
    assert.equal(requests.length, before)
    await page.locator('#assistantStop').click()
    await delayed.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ paragraphs: ['This stale reply must not appear.'], resourceIds: [] }) }).catch(() => {})
    assert.equal(await page.locator('#assistantMessages').getByText('This stale reply must not appear.').count(), 0)
    mode = 'malicious'
    await page.locator('#assistantRetry').click()
    await page.waitForFunction(() => !document.getElementById('assistantRetry').hidden)
    assert.equal(await page.locator('#assistantMessages img').count(), 0)
    assert.equal(await page.locator('#assistantMessages').getByText('<img src=x onerror=alert(1)>').count(), 0)
    await page.locator('#assistantNewChat').click()
    assert.equal(await page.locator('.assistant-message').count(), 0)
    assert.equal(await page.locator('#assistantContext').isVisible(), false)
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ simulatedBluetoothAndProvider: true, completionDoesNotSend: true, offlinePreset: true, comparisonExcludesSelfAndOtherBaseline: true, retryWithoutDuplicates: true, savedCaptureContext: true, conversationalFollowups: true, resourceLinks: true, activeRecordingUnchanged: true, duplicateRequestsBlocked: true, stopRejectsStaleReply: true, unsafeOutputHidden: true, errors }, null, 2))
  } finally { await context.close(); await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
