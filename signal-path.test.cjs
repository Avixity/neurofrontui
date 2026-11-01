const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { randomUUID } = require("node:crypto")

// Synthetic BLE notifications and clock-controlled animation frames, not a physical device.
const source = fs.readFileSync(path.join(__dirname, "app.js"), "utf8").replace(/\binit\(\)\s*$/, "")
const scoreSource = fs.readFileSync(path.join(__dirname, "score-config.js"), "utf8")
const baselineWave = index => Math.sin(index / 5) * 12 + Math.cos(index / 2) * 3
const captureWave = index => Math.sin(index / 7) * 12
const legacy = {
  // Recorded from the actual computeSignalFeatures/compositeActivity in restored commit 7901e14.
  baseline: { mean: 0.1700084883636582, rms: 8.743554804535048, stdDev: 8.741901837345937, peakToPeak: 29.278397970773813, derivativeMean: 1.6740652002762466 },
  capture: { mean: 0.1770852119619287, rms: 8.511965571847439, stdDev: 8.510123308391037, peakToPeak: 23.999976016009942, derivativeMean: 1.0853791145160157 },
  score: 44.756897353797434
}

async function fixture() {
  const elements = new Map(), storage = new Map(), frames = [], savedCaptures = []
  const clock = { now: 1000 }, calls = { discoveries: 0, notifications: 0, rendered: 0 }
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      id, textContent: "", style: {}, dataset: {}, hidden: false, disabled: false,
      classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {},
      getContext: () => ({ createLinearGradient: () => ({ addColorStop() {} }) })
    })
    return elements.get(id)
  }
  const characteristic = new EventTarget()
  characteristic.startNotifications = async () => { calls.notifications++; return characteristic }
  const device = new EventTarget()
  device.gatt = {
    connected: false,
    async connect() { this.connected = true; return this },
    async getPrimaryService(uuid) {
      calls.service = uuid
      return { async getCharacteristic(uuid) { calls.characteristic = uuid; return characteristic } }
    }
  }
  const context = vm.createContext({
    document: { documentElement: { lang: "en" }, getElementById: element, addEventListener() {} },
    window: {
      crypto: { randomUUID },
      NeuroFrontI18n: { setText: (node, text) => { node.textContent = text }, setMessage: (node, key) => { node.textContent = key } },
      NeuroFrontHistory: { record: capture => savedCaptures.push(JSON.parse(JSON.stringify(capture))) }
    },
    navigator: { bluetooth: { async requestDevice(options) { calls.discoveries++; calls.options = options; return device } } },
    performance: { now: () => clock.now },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    requestAnimationFrame(callback) { frames.push(callback); return frames.length },
    Chart: class {
      constructor(_ctx, config) { this.data = config.data; this.options = config.options }
      update() { calls.rendered++ }
    },
    TextDecoder, Date, Intl, setTimeout, console
  })
  vm.runInContext(scoreSource, context, { filename: "score-config.js" })
  vm.runInContext(source, context, { filename: "app.js" })
  const evaluate = code => vm.runInContext(code, context)
  const read = code => JSON.parse(evaluate(`JSON.stringify(${code})`))
  await evaluate("connectBluetooth()")
  evaluate("initChart(); animationLoop(performance.now())")

  function notify(raw) {
    characteristic.value = new DataView(new TextEncoder().encode(raw).buffer)
    characteristic.dispatchEvent(new Event("characteristicvaluechanged"))
  }
  function tick(raw, milliseconds = 50) {
    clock.now += milliseconds
    if (raw !== undefined) notify(raw)
    const scheduled = frames.splice(0)
    assert.equal(scheduled.length, 1, "There must be exactly one acquisition animation loop")
    scheduled[0](clock.now)
  }
  const valueTick = value => tick(`${value},36.5,4.1\0`)
  function calibrate(wave = baselineWave) {
    evaluate("startCalibration()")
    for (let index = 0; index < 400; index++) valueTick(wave(index))
    assert.equal(evaluate("state.calibration.active"), false)
    assert.equal(evaluate("state.baseline.ready"), true)
    assert.equal(evaluate("state.baseline.samples.length"), 400)
    assert.equal(evaluate("state.flow"), "ready")
  }
  function capture(wave) {
    evaluate("startMeasurement()")
    assert.equal(evaluate("state.measurement.active"), true)
    for (let index = 0; index < 300; index++) valueTick(wave(index))
    assert.equal(evaluate("state.measurement.active"), false)
    assert.equal(evaluate("state.measurement.completed"), true)
    assert.equal(evaluate("state.exportSnapshot.buffer.length"), 300)
    return read("state.exportSnapshot")
  }
  return { evaluate, read, notify, tick, valueTick, calibrate, capture, clock, calls, elements, savedCaptures }
}

function near(actual, expected, description) {
  assert.ok(Math.abs(actual - expected) < 1e-12, `${description}: ${actual} differs from original ${expected}`)
}

const results = {}
const tests = {
  async realNotificationPathPreservesOriginalCalculations() {
    const app = await fixture()
    app.calibrate()
    assert.deepEqual(app.read("state.baseline.samples"), Array.from({ length: 400 }, (_, index) => baselineWave(index)))
    for (const [name, value] of Object.entries(legacy.baseline)) near(app.evaluate(`state.baseline.${name}`), value, `Baseline ${name}`)
    const capture = app.capture(captureWave)
    assert.deepEqual(capture.buffer, Array.from({ length: 300 }, (_, index) => captureWave(index)))
    const features = app.read("computeSignalFeatures(state.exportSnapshot.buffer)")
    for (const [name, value] of Object.entries(legacy.capture)) near(features[name], value, `Capture ${name}`)
    near(app.evaluate("state.stress.score"), legacy.score, "Final score")
    assert.equal(app.evaluate("state.stress.label"), "Balanced")
    assert.equal(app.savedCaptures.length, 1)
    assert.deepEqual(app.savedCaptures[0].samples, capture.buffer)
    assert.equal(app.calls.notifications, 1)
    assert.equal(app.calls.service, "12345678-1234-1234-1234-1234567890ab")
    assert.equal(app.calls.characteristic, "abcd1234-5678-1234-5678-abcdef123456")
    assert.deepEqual(JSON.parse(JSON.stringify(app.calls.options)), {
      filters: [{ name: "NeuroFront" }, { namePrefix: "NeuroFront" }],
      optionalServices: ["12345678-1234-1234-1234-1234567890ab"]
    })
    results.calibrationNotifications = 400
    results.captureNotifications = 300
    results.captureDurationMs = 15000
    results.originalScore = app.evaluate("state.stress.score")
  },
  async lowAmplitudeSignalUsesReadableLiveAndSavedScale() {
    const app = await fixture()
    app.calibrate(index => index % 2 ? 1.66 : 1.64)
    const capture = app.capture(index => index % 2 ? 1.66 : 1.64)
    const range = Math.max(...capture.buffer) - Math.min(...capture.buffer)
    const liveSpan = app.evaluate("state.chart.options.scales.y.max - state.chart.options.scales.y.min")
    const storedSpan = capture.axisMax - capture.axisMin
    results.lowAmplitude = {
      receivedRange: range,
      previousMinimumAxisSpan: 26,
      previousVerticalOccupancyPercent: range / 26 * 100,
      currentVerticalOccupancyPercent: range / liveSpan * 100,
      savedVerticalOccupancyPercent: range / storedSpan * 100
    }
    assert.ok(range / liveSpan >= 0.5, `Live signal occupies only ${(range / liveSpan * 100).toFixed(4)}% of plot height`)
    assert.ok(range / storedSpan >= 0.5, "Saved capture must retain the readable live scale")
    assert.deepEqual(app.read("state.chart.data.datasets[0].data"), capture.buffer)
    const labels = ["yAxisBottom", "yAxisMid", "yAxisTop"].map(id => app.elements.get(id).textContent)
    assert.equal(new Set(labels).size, 3, `Small-range axis labels must be distinct: ${labels.join(", ")}`)
    assert.ok(labels.some(label => /\d[.,]\d/.test(label)), "Small-range labels need decimal precision")
    const values = labels.map(Number)
    assert.ok(values[0] < values[1] && values[1] < values[2], "Numeric labels must increase with the axis")
    results.lowAmplitude.labels = labels
  },
  async firstAdcOffsetPointIsNeverClipped() {
    const app = await fixture()
    app.calibrate(index => 2048 + Math.sin(index / 5) * 2)
    app.evaluate("startMeasurement()")
    for (const value of [2048, 2050, 2046, 2049]) {
      app.valueTick(value)
      const axis = app.read("state.chart.options.scales.y")
      const samples = app.read("state.measurement.samples")
      assert.ok(samples.every(sample => sample >= axis.min && sample <= axis.max), `Received values must be visible immediately inside [${axis.min}, ${axis.max}]`)
    }
    results.firstAdcOffsetPoint = 2048
  },
  async malformedNotificationsCannotRefreshAStaleSignal() {
    const app = await fixture()
    app.calibrate()
    app.tick("1.65,36.5,4.1\0")
    const lastValid = app.evaluate("state.lastIncomingTime")
    for (const raw of ["", "\0", "status:ready", "NaN,36.5,4.1", "Infinity,36.5,4.1", ",36.5,4.1"]) {
      app.tick(raw)
      assert.equal(app.evaluate("state.lastIncomingTime"), lastValid, `Invalid payload ${JSON.stringify(raw)} must not make the signal fresh`)
      assert.equal(app.evaluate("state.bluetoothValue"), 1.65, "Invalid data must not replace the last valid numeric sample")
    }
    for (let index = 0; index < 100; index++) app.tick("not-a-number")
    assert.equal(app.evaluate("hasFreshBluetoothSignal(performance.now())"), false)
    app.evaluate("startMeasurement()")
    for (let index = 0; index < 300; index++) app.tick("invalid,36.5,4.1")
    assert.equal(app.evaluate("state.measurement.samples.length"), 0, "Invalid notifications must not manufacture stale or zero samples")
    assert.equal(app.evaluate("state.measurement.completed"), false)
    assert.equal(app.savedCaptures.length, 0, "No-data capture must never become a completed history record")
  },
  async malformedOnlyStreamDoesNotCreateZeroSamples() {
    const app = await fixture()
    for (let index = 0; index < 100; index++) app.tick("invalid,36.5,4.1")
    assert.equal(app.evaluate("state.lastIncomingTime"), 0)
    assert.equal(app.evaluate("nextBluetoothValue(performance.now())"), null)
    app.evaluate("startCalibration()")
    for (let index = 0; index < 500; index++) app.tick("invalid,36.5,4.1")
    assert.equal(app.evaluate("state.baseline.ready"), false)
    assert.equal(app.evaluate("state.calibration.active"), false)
    assert.equal(app.evaluate("state.baseline.samples.length"), 0)
  }
}

;(async () => {
  const failures = []
  for (const [name, run] of Object.entries(tests)) {
    try { await run(); results[name] = true }
    catch (error) { results[name] = false; failures.push({ test: name, error: error.message }) }
  }
  console.log(JSON.stringify({ simulatedBleAndClock: true, physicalDeviceVerified: false, directSampleInjection: false, ...results, failures }, null, 2))
  if (failures.length) process.exitCode = 1
})().catch(error => { console.error(error); process.exitCode = 1 })
