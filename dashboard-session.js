(() => {
  "use strict"
  const ui = Object.fromEntries(["modeSelect", "adaptivePanel", "adaptiveStart", "adaptiveStop",
    "adaptiveTime", "adaptiveStatus", "adaptiveCoverage", "adaptiveSaveStatus"].map(id => [id, document.getElementById(id)]))
  const durations = new Map([["adaptive", 0], ["adaptive-5", 300000], ["adaptive-10", 600000]])
  const windowMs = MEASUREMENT_MS
  const slotMs = SAMPLE_INTERVAL
  const slots = windowMs / slotMs
  const maxGapMs = 1000
  let choice = "standard", run = null, result = null, message = "", lastLabel = ""
  let elapsed = 0
  const owner = () => window.NeuroFrontAccount?.owner?.() || null
  const busy = () => run !== null
  const selected = () => durations.has(choice)
  const ready = now => !document.hidden && isDeviceConnected() && !!state.characteristic && state.baseline.ready &&
    ["ready", "complete"].includes(state.flow) && !state.measurement.active && !state.calibration.active &&
    hasFreshBluetoothSignal(now) && now - state.lastIncomingTime < maxGapMs
  const locked = () => busy() || state.measurement.active || state.calibration.active || refs.measurementDialog.open
  function timer(ms) {
    const seconds = Math.floor(Math.max(0, ms) / 1000)
    const display = [Math.floor(seconds / 60), seconds % 60].map(value => String(value).padStart(2, "0")).join(":")
    if (ui.adaptiveTime.textContent !== display) ui.adaptiveTime.textContent = display
  }
  function render(now = performance.now()) {
    ui.modeSelect.disabled = locked()
    if (!selected()) return
    const canBegin = ready(now)
    ui.adaptiveStart.disabled = !canBegin || busy()
    ui.adaptiveStart.hidden = busy()
    ui.adaptiveStop.hidden = !busy()
    document.body.classList.toggle("adaptive-calibrating", state.calibration.active)
    timer(run ? Math.min(now - run.start, run.limit || Infinity) : elapsed)
    const label = run ? "running" : message || (canBegin ? "ready" : "missing")
    if (label !== lastLabel) {
      lastLabel = label
      window.NeuroFrontI18n.setMessage(ui.adaptiveStatus, "dash." + label, result || {})
    }
    ui.adaptiveCoverage.hidden = !result
    ui.adaptiveSaveStatus.hidden = !result || result.saved
  }
  function endRun(now) {
    run = null
    window.NeuroFrontAccount?.deviceBusy()
    updateControlsAvailability(now)
    render(now)
  }
  function cancel(reason = "cancelled", now = performance.now()) {
    if (!run) return
    const focused = document.activeElement === ui.adaptiveStop
    result = null
    elapsed = 0
    message = reason
    endRun(now)
    if (focused && !document.hidden) (ui.adaptiveStart.disabled ? ui.modeSelect : ui.adaptiveStart).focus({ preventScroll: true })
  }
  function clearResult() {
    result = null
    message = lastLabel = ""
    elapsed = 0
    ui.adaptiveCoverage.hidden = true
    ui.adaptiveSaveStatus.hidden = true
  }
  function reset() {
    run = null
    clearResult()
    ui.modeSelect.value = choice = "standard"
    ui.adaptivePanel.hidden = true
    window.NeuroFrontI18n.setText(ui.adaptiveCoverage, "")
    window.NeuroFrontI18n.setText(ui.adaptiveStatus, "")
    timer(0)
    document.body.classList.remove("mode-adaptive", "adaptive-calibrating")
    render()
  }
  function begin() {
    const now = performance.now(), limit = durations.get(choice)
    if (run || !selected() || !ready(now)) return
    const baseline = Object.fromEntries(["mean", "rms", "stdDev", "peakToPeak", "derivativeMean"].map(k => [k, state.baseline[k]]))
    if (!Object.values(baseline).every(Number.isFinite) || !(baseline.peakToPeak > 0)) {
      clearResult(); message = "invalid"; render(now); return
    }
    clearResult()
    const wall = Date.now()
    run = { start: now, limit, owner: owner(), baseline, reference: state.baseline.createdAt,
      characteristic: state.characteristic, lastPacket: now, lastPacketWall: wall, index: 0, values: new Array(slots), mean: 0, first: null, last: null }
    window.NeuroFrontAccount?.deviceBusy()
    updateControlsAvailability(now)
    render(now)
    ui.adaptiveStop.focus({ preventScroll: true })
  }
  function validRun(now) {
    if (!run) return false
    if (owner() !== run.owner || !state.baseline.ready || state.baseline.createdAt !== run.reference) { cancel("changed", now); return false }
    if (document.hidden) { cancel("visibility", now); return false }
    const wallGap = Date.now() - run.lastPacketWall
    if (wallGap < 0 || wallGap > maxGapMs || !isDeviceConnected() || !state.characteristic || state.characteristic !== run.characteristic ||
        now < run.lastPacket || now - run.lastPacket > maxGapMs) { cancel("lost", now); return false }
    return true
  }
  function closeWindow(now) {
    const values = run.values.filter(Number.isFinite)
    if (values.length < slots * .8 || run.first > maxGapMs || run.last === null || windowMs - run.last > maxGapMs ||
        Math.min(...values) === Math.max(...values)) { cancel("invalid", now); return false }
    const score = estimateWindowScore(values, run.baseline)
    if (!Number.isFinite(score) || score < 0 || score > 100) { cancel("invalid", now); return false }
    run.index++
    run.mean += (score - run.mean) / run.index
    run.values = new Array(slots)
    run.first = run.last = null
    return true
  }
  function finish(now, requestedStop) {
    const duration = Math.floor(Math.min(now - run.start, run.limit || Infinity))
    if (!run.index) { cancel("tooShort", now); return }
    const count = run.index
    const score = Math.round(run.mean)
    const saved = window.NeuroFrontAdaptiveHistory?.save({
      type: "adaptive", completedAt: Date.now(), durationMs: duration, presetMs: run.limit,
      end: requestedStop ? "manual" : "timer", count, score
    }, run.owner) === true
    const focused = document.activeElement === ui.adaptiveStop
    elapsed = duration
    result = { score, count, duration: window.NeuroFrontAdaptiveHistory?.formatDuration(count * windowMs) || String(count * 15), saved }
    message = "completed"
    lastLabel = ""
    window.NeuroFrontI18n.setMessage(ui.adaptiveCoverage, "dash.coverageElapsed", result)
    endRun(now)
    if (focused) (ui.adaptiveStart.disabled ? ui.modeSelect : ui.adaptiveStart).focus({ preventScroll: true })
  }
  function advance(now) {
    if (!validRun(now)) return false
    const target = Math.floor(Math.min(now - run.start, run.limit || Infinity) / windowMs)
    while (run.index < target) if (!closeWindow(now)) return false
    if (run.limit && now - run.start >= run.limit) {
      finish(now, false)
      return false
    }
    return true
  }
  function stop() {
    const now = performance.now()
    if (advance(now)) finish(now, true)
  }
  function sample(value, now, rawValue) {
    if (!run) return
    if (!Number.isFinite(value) || !/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(rawValue.trim())) {
      cancel("invalid", now); return
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
    if ((next !== "standard" && !durations.has(next)) || locked()) {
      ui.modeSelect.value = choice; return
    }
    if (next === choice) return
    choice = next
    clearResult()
    ui.adaptivePanel.hidden = !selected()
    document.body.classList.toggle("mode-adaptive", selected())
    updateControlsAvailability(performance.now())
    render()
  })
  ui.adaptiveStart.addEventListener("click", begin)
  ui.adaptiveStop.addEventListener("click", stop)
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancel("visibility") })
  document.addEventListener("neurofront:languagechange", () => {
    if (!result) return
    result = { ...result, duration: window.NeuroFrontAdaptiveHistory.formatDuration(result.count * windowMs) }
    window.NeuroFrontI18n.setMessage(ui.adaptiveCoverage, "dash.coverageElapsed", result)
  })
  window.addEventListener("pagehide", () => cancel("visibility"))
  window.NeuroFrontAdaptive = Object.freeze({ selected, busy, sample, tick, cancel, reset })
  reset()
})()
