const assert = require('node:assert/strict')
const path = require('node:path')
const os = require('node:os')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright')

// Browser rendering and real-time synthetic notifications. No physical device is used.
;(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined })
  const page = await browser.newPage({ viewport: { width: 1366, height: 900 }, acceptDownloads: true })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  try {
    await page.addInitScript(() => {
      const characteristic = new EventTarget(), device = new EventTarget()
      characteristic.startNotifications = async () => characteristic
      device.gatt = {
        connected: false,
        async connect() { this.connected = true; return this },
        disconnect() { this.connected = false; device.dispatchEvent(new Event('gattserverdisconnected')) },
        async getPrimaryService() { return { async getCharacteristic() { return characteristic } } }
      }
      Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: { requestDevice: async () => device } })
      window.signalTest = {
        timer: null, device,
        emit(raw) { characteristic.value = new DataView(new TextEncoder().encode(raw).buffer); characteristic.dispatchEvent(new Event('characteristicvaluechanged')) },
        stream(type) {
          clearInterval(this.timer)
          let index = 0
          this.timer = setInterval(() => {
            const value = type === 'zero' ? 0 : 1.65 + Math.sin(index++ / 3) * 0.01
            this.emit(type === 'invalid' ? 'not-a-sample' : `${value},36.5,4.1\0`)
          }, 50)
        },
        stop() { clearInterval(this.timer) }
      }
    })
    await page.goto(process.env.NEUROFRONT_URL || 'http://localhost:5183')
    await page.waitForFunction(() => document.body.classList.contains('is-ready') && window.NeuroFrontHistory)
    await page.locator('#connectButton').click()
    await page.waitForFunction(() => Boolean(state.characteristic))
    await page.waitForFunction(() => document.getElementById('signalDetail').textContent.includes('Waiting for signal data'))
    await page.evaluate(() => signalTest.stream('small'))
    await page.locator('#recalibrateButton').click()
    await page.waitForFunction(() => state.flow === 'ready', { }, { timeout: 28000 })
    assert.equal(await page.evaluate(() => state.baseline.samples.length), 400)
    await page.locator('#measureButton').click()
    assert.equal(await page.evaluate(() => state.measurement.active), false)
    await page.locator('#beginMeasurementButton').click()
    await page.waitForFunction(() => state.measurement.samples.length >= 40)
    await page.evaluate(() => window.scrollTo(0, 0))
    const live = await page.evaluate(() => {
      const points = state.chart.getDatasetMeta(0).data.filter((_, index) => index < state.measurement.samples.length)
      const ys = points.map(point => point.y)
      return { pixels: Math.max(...ys) - Math.min(...ys), height: state.chart.chartArea.height, value: document.getElementById('signalValue').textContent }
    })
    assert.ok(live.pixels / live.height > 0.5, JSON.stringify(live))
    assert.ok(Number(live.value) > 1.63 && Number(live.value) < 1.67)
    await page.locator('#signalDiagnostics summary').click()
    await page.screenshot({ path: path.join(os.tmpdir(), 'neurofront-signal-desktop.png') })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.locator('#signalDiagnostics').scrollIntoViewIfNeeded()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: path.join(os.tmpdir(), 'neurofront-signal-mobile.png') })
    await page.waitForFunction(() => state.flow === 'complete', {}, { timeout: 19000 })
    await page.evaluate(() => signalTest.stop())
    const capture = await page.evaluate(() => ({ id: state.measurement.id, samples: state.exportSnapshot.buffer.length, min: state.exportSnapshot.axisMin, max: state.exportSnapshot.axisMax }))
    assert.ok(capture.samples >= 290 && capture.samples <= 310, JSON.stringify(capture))
    assert.ok(capture.max - capture.min < 0.04)
    await page.locator(`[data-capture-id="${capture.id}"]`).click()
    const trace = await page.locator('#captureGraph path').getAttribute('d')
    const ys = [...trace.matchAll(/[ML][\d.]+,([\d.-]+)/g)].map(match => Number(match[1]))
    assert.ok(Math.max(...ys) - Math.min(...ys) > 100)
    const downloading = page.waitForEvent('download')
    await page.locator('#captureExport').click()
    const download = await downloading
    assert.equal(await download.failure(), null)
    await page.keyboard.press('Escape')
    await page.evaluate(() => signalTest.stream('zero'))
    await page.waitForFunction(() => document.getElementById('signalDetail').textContent.includes('unchanged value: 0'))
    await page.locator('#languageButton').click()
    await page.locator('#language-hi').click()
    assert.ok(!(await page.locator('#signalDetail').textContent()).includes('unchanged'))
    await page.locator('#languageButton').click()
    await page.locator('#language-en').click()
    await page.evaluate(() => { signalTest.stream('invalid') })
    await page.waitForFunction(() => document.getElementById('signalDetail').textContent.includes('could not be read'))
    const invalidCount = await page.evaluate(() => state.signalInput.valid)
    await page.locator('#measureAgainButton').click()
    await page.locator('#savedBaselineButton').click()
    await page.locator('#measureButton').click()
    await page.locator('#beginMeasurementButton').click()
    await page.waitForTimeout(700)
    assert.equal(await page.evaluate(() => state.measurement.samples.length), 0)
    assert.equal(await page.evaluate(() => state.signalInput.valid), invalidCount)
    await page.evaluate(() => { signalTest.stop(); signalTest.device.gatt.disconnect() })
    await page.locator('#signalDiagnostics').waitFor({ state: 'hidden' })
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ simulatedNotifications: true, physicalDeviceVerified: false, actualCalibrationSeconds: 20, actualCaptureSeconds: 15, capture, renderedWaveform: live, desktopAndMobile: true, historyAndPng: true, zeroAndInvalidDistinguished: true, languageSwitch: true, noConsoleErrors: true }, null, 2))
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
