(() => {
  "use strict"
  const ui = Object.fromEntries(["modeSelect", "adaptivePanel", "adaptiveDuration", "adaptiveStart", "adaptiveStop",
    "adaptiveTime", "adaptiveStatus", "adaptiveCoverage"].map(id => [id, document.getElementById(id)]))
  const windowMs = MEASUREMENT_MS
  const slotMs = SAMPLE_INTERVAL
  const slots = windowMs / slotMs
  const maxGapMs = 1000
  let mode = "standard", run = null, result = null, message = "", lastLabel = ""
  let elapsed = 0
  const owner = () => window.NeuroFrontAccount?.owner?.() || null
  const busy = () => run !== null
  const selected = () => mode === "adaptive"
  const ready = now => !document.hidden && isDeviceConnected() && !!state.characteristic && state.baseline.ready &&
    ["ready", "complete"].includes(state.flow) && !state.measurement.active && !state.calibration.active &&
    hasFreshBluetoothSignal(now) && now - state.lastIncomingTime < maxGapMs
  function timer(ms) {
    const seconds = Math.floor(Math.max(0, ms) / 1000)
    const display = [Math.floor(seconds / 60), seconds % 60].map(value => String(value).padStart(2, "0")).join(":")
    if (ui.adaptiveTime.textContent !== display) ui.adaptiveTime.textContent = display
  }
  function render(now = performance.now()) {
    ui.modeSelect.disabled = busy() || state.measurement.active || state.calibration.active || refs.measurementDialog.open
    if (!selected()) return
    const canBegin = ready(now)
    ui.adaptiveStart.disabled = !canBegin || busy()
    ui.adaptiveStart.hidden = busy()
    ui.adaptiveStop.hidden = !busy()
    ui.adaptiveDuration.disabled = busy()
    document.body.classList.toggle("adaptive-calibrating", state.calibration.active)
    timer(run ? Math.min(now - run.start, run.duration) : elapsed)
    const label = run ? "running" : message || (canBegin ? "ready" : "missing")
    if (label !== lastLabel) {
      lastLabel = label
      window.NeuroFrontI18n.setMessage(ui.adaptiveStatus, "dash." + label, result || {})
    }
    ui.adaptiveCoverage.hidden = !result
  }
  function cancel(reason = "cancelled") {
    if (!run) return
    run = null
    result = null
    elapsed = 0
    message = reason
    window.NeuroFrontAccount?.deviceBusy()
    render()
  }
  function reset() {
    run = null
    result = null
    message = lastLabel = ""
    elapsed = 0
    ui.modeSelect.value = mode = "standard"
    ui.adaptiveDuration.value = "5"
    ui.adaptivePanel.hidden = true
    ui.adaptiveCoverage.hidden = true
    window.NeuroFrontI18n.setText(ui.adaptiveCoverage, "")
    window.NeuroFrontI18n.setText(ui.adaptiveStatus, "")
    timer(0)
    document.body.classList.remove("mode-adaptive", "adaptive-calibrating")
    render()
  }
  function begin() {
    const now = performance.now(), minutes = Number(ui.adaptiveDuration.value)
    if (run || !selected() || ![5, 10].includes(minutes) || !ready(now)) return
    const baseline = Object.fromEntries(["mean", "rms", "stdDev", "peakToPeak", "derivativeMean"].map(k => [k, state.baseline[k]]))
    if (!Object.values(baseline).every(Number.isFinite) || !(baseline.peakToPeak > 0)) {
      result = null; message = "invalid"; elapsed = 0; render(now); return
    }
    result = null
    elapsed = 0
    message = ""
    run = { start: now, duration: minutes * 60000, owner: owner(), baseline, reference: state.baseline.createdAt,
      characteristic: state.characteristic, lastPacket: now, lastPacketWall: Date.now(), index: 0, values: new Array(slots), total: 0, count: 0, first: null, last: null }
    window.NeuroFrontAccount?.deviceBusy()
    updateControlsAvailability(now)
    render(now)
    ui.adaptiveStop.focus({ preventScroll: true })
  }
  function validRun(now) {
    if (!run) return false
    if (owner() !== run.owner || !state.baseline.ready || state.baseline.createdAt !== run.reference) { cancel("changed"); return false }
    if (document.hidden) { cancel("visibility"); return false }
    const wallGap = Date.now() - run.lastPacketWall
    if (wallGap < 0 || wallGap > maxGapMs || !isDeviceConnected() || !state.characteristic || state.characteristic !== run.characteristic || now < run.start ||
        now - run.lastPacket > maxGapMs) { cancel("lost"); return false }
    return true
  }
  function closeWindow() {
    const values = run.values.filter(Number.isFinite)
    if (values.length < slots * .8 || run.first > maxGapMs || run.last === null || windowMs - run.last > maxGapMs ||
        Math.min(...values) === Math.max(...values)) { cancel("invalid"); return false }
    const score = estimateWindowScore(values, run.baseline)
    if (!Number.isFinite(score)) { cancel("invalid"); return false }
    run.total += score
    run.count++
    run.index++
    run.values = new Array(slots)
    run.first = run.last = null
    return true
  }
  function advance(now) {
    if (!validRun(now)) return false
    const target = Math.floor(Math.min(now - run.start, run.duration) / windowMs)
    while (run.index < target) if (!closeWindow()) return false
    if (now - run.start >= run.duration) {
      elapsed = run.duration
      result = { score: Math.round(run.total / run.count), count: run.count, minutes: run.duration / 60000 }
      run = null
      message = "completed"
      lastLabel = ""
      window.NeuroFrontI18n.setMessage(ui.adaptiveCoverage, "dash.coverage", result)
      window.NeuroFrontAccount?.deviceBusy()
      render(now)
      return false
    }
    return true
  }
  function sample(value, now, rawValue) {
    if (!run) return
    if (!Number.isFinite(value) || !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(rawValue.trim())) {
      cancel("invalid"); return
    }
    if (!advance(now)) return
    const inside = now - run.start - run.index * windowMs
    run.lastPacket = now
    run.lastPacketWall = Date.now()
    run.values[Math.min(slots - 1, Math.floor(inside / slotMs))] = value
    if (run.first === null) run.first = inside
    run.last = inside
  }
  function tick(now) {
    if (run) advance(now)
    render(now)
  }
  ui.modeSelect.addEventListener("change", () => {
    const next = ui.modeSelect.value
    if (!["adaptive", "standard"].includes(next) || busy() || state.calibration.active || state.measurement.active || refs.measurementDialog.open) {
      ui.modeSelect.value = mode; return
    }
    mode = next
    ui.adaptivePanel.hidden = !selected()
    document.body.classList.toggle("mode-adaptive", selected())
    updateControlsAvailability(performance.now())
    render()
  })
  ui.adaptiveStart.addEventListener("click", begin)
  ui.adaptiveStop.addEventListener("click", () => {
    cancel("cancelled")
    if (ui.adaptiveStart.disabled) ui.adaptiveDuration.focus()
    else ui.adaptiveStart.focus()
  })
  ui.adaptiveDuration.addEventListener("change", () => {
    if (busy()) return
    message = lastLabel = ""
    elapsed = 0
    result = null
    render()
  })
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel("visibility") })
  window.addEventListener("pagehide", () => cancel("visibility"))
  window.NeuroFrontAdaptive = Object.freeze({ selected, busy, sample, tick, cancel, reset })
  reset()
})()
