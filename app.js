const SERVICE_UUID = "12345678-1234-1234-1234-1234567890ab"
const CHAR_UUID = "abcd1234-5678-1234-5678-abcdef123456"
const DEVICE_NAME = "NeuroFront"
const BASELINE_MS = 20000
const MEASUREMENT_MS = 15000
const SAMPLE_INTERVAL = 50
const BASELINE_SAMPLE_COUNT = Math.round(BASELINE_MS / SAMPLE_INTERVAL)
const BUFFER_SIZE = Math.round(MEASUREMENT_MS / SAMPLE_INTERVAL)
const SIGNAL_TIMEOUT_MS = 5000
const RING_CIRCUMFERENCE = Math.PI * 104
const IDLE_BASELINE = 0
const DISCONNECTED_TEMPERATURE = 0
const IDLE_TEMPERATURE = 36.58

const refs = {
  statusPill: document.getElementById("statusPill"),
  statusText: document.getElementById("statusText"),
  sourceBadge: document.getElementById("sourceBadge"),
  leadState: document.getElementById("leadState"),
  signalValue: document.getElementById("signalValue"),
  signalDetail: document.getElementById("signalDetail"),
  tempValue: document.getElementById("tempValue"),
  tempTrend: document.getElementById("tempTrend"),
  tempTrendText: document.getElementById("tempTrendText"),
  stressScore: document.getElementById("stressScore"),
  stressFill: document.getElementById("stressFill"),
  stressLabel: document.getElementById("stressLabel"),
  stressFeedback: document.getElementById("stressFeedback"),
  baselineNote: document.getElementById("baselineNote"),
  connectButton: document.getElementById("connectButton"),
  measureButton: document.getElementById("measureButton"),
  exportButton: document.getElementById("exportButton"),
  countdownCard: document.getElementById("countdownCard"),
  countdownRing: document.getElementById("countdownRing"),
  countdownValue: document.getElementById("countdownValue"),
  measurementState: document.getElementById("measurementState"),
  chartOverlay: document.getElementById("chartOverlay"),
  yAxisTop: document.getElementById("yAxisTop"),
  yAxisMid: document.getElementById("yAxisMid"),
  yAxisBottom: document.getElementById("yAxisBottom"),
  xAxisStart: document.getElementById("xAxisStart"),
  xAxisQuarter: document.getElementById("xAxisQuarter"),
  xAxisHalf: document.getElementById("xAxisHalf"),
  xAxisEnd: document.getElementById("xAxisEnd"),
  summaryPanel: document.getElementById("summaryPanel"),
  activityLabel: document.getElementById("activityLabel"),
  avgValue: document.getElementById("avgValue"),
  peakValue: document.getElementById("peakValue"),
  minValue: document.getElementById("minValue"),
  chartCanvas: document.getElementById("signalChart")
}

const state = {
  chart: null,
  displayBuffer: Array(BUFFER_SIZE).fill(IDLE_BASELINE),
  liveBuffer: Array(BUFFER_SIZE).fill(IDLE_BASELINE),
  lastFrame: 0,
  sampleAccumulator: 0,
  liveValue: IDLE_BASELINE,
  displaySignal: IDLE_BASELINE,
  signalMean: IDLE_BASELINE,
  signalVariance: 0,
  activity: 0,
  signalDelta: 0,
  temperature: DISCONNECTED_TEMPERATURE,
  displayTemperature: DISCONNECTED_TEMPERATURE,
  noiseCurrent: 0,
  noiseTarget: 0,
  noiseShiftAt: 0,
  temperatureTrend: "stable",
  status: "disconnected",
  leadOff: false,
  source: "idle",
  bluetoothValue: IDLE_BASELINE,
  lastIncomingTime: 0,
  device: null,
  characteristic: null,
  axisMin: -20,
  axisMax: 20,
  measurement: {
    active: false,
    startTime: 0,
    samples: [],
    completed: false,
    revealed: false
  },
  baseline: {
    samples: [],
    ready: false,
    mean: 0,
    rms: 0,
    stdDev: 0,
    peakToPeak: 0,
    derivativeMean: 0
  },
  stress: {
    score: 50,
    label: "Baseline",
    feedback: "Connect and sit relaxed for 20 seconds to calibrate your session baseline."
  },
  summary: {
    average: 0,
    peak: 0,
    minimum: 0,
    activityLabel: "Stable"
  },
  exportSnapshot: {
    buffer: [],
    axisMin: -20,
    axisMax: 20
  }
}

const glowPlugin = {
  id: "neurofrontGlow",
  beforeDatasetDraw(chart) {
    const { ctx } = chart
    ctx.save()
    ctx.shadowColor = "rgba(83, 215, 188, 0.28)"
    ctx.shadowBlur = 18
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
  },
  afterDatasetDraw(chart) {
    chart.ctx.restore()
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function lerp(start, end, amount) {
  return start + (end - start) * amount
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min)
}

function computeSignalFeatures(samples) {
  if (!samples.length) {
    return {
      mean: 0,
      rms: 0,
      stdDev: 0,
      peakToPeak: 0,
      derivativeMean: 0
    }
  }
  let sum = 0
  let squareSum = 0
  let min = Infinity
  let max = -Infinity
  let derivativeSum = 0
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index]
    sum += value
    squareSum += value * value
    if (value < min) {
      min = value
    }
    if (value > max) {
      max = value
    }
    if (index > 0) {
      derivativeSum += Math.abs(value - samples[index - 1])
    }
  }
  const mean = sum / samples.length
  let varianceSum = 0
  for (const value of samples) {
    varianceSum += (value - mean) ** 2
  }
  return {
    mean,
    rms: Math.sqrt(squareSum / samples.length),
    stdDev: Math.sqrt(varianceSum / samples.length),
    peakToPeak: max - min,
    derivativeMean: samples.length > 1 ? derivativeSum / (samples.length - 1) : 0
  }
}

function compositeActivity(features) {
  return features.stdDev * 0.5 + features.peakToPeak * 0.35 + features.derivativeMean * 0.15
}

function isDeviceConnected() {
  return Boolean(state.device && state.device.gatt && state.device.gatt.connected)
}

function canStartMeasurement() {
  return Boolean(state.characteristic && isDeviceConnected() && state.baseline.ready)
}

function setStatus(status) {
  state.status = status
  refs.statusPill.dataset.state = status
  if (status === "connecting") {
    refs.statusText.textContent = "Connecting"
    return
  }
  if (status === "connected") {
    refs.statusText.textContent = "Connected"
    return
  }
  if (status === "leads-off") {
    refs.statusText.textContent = "Leads Off"
    return
  }
  refs.statusText.textContent = "Disconnected"
}

function updateSourceBadge(source) {
  if (state.measurement.completed && state.exportSnapshot.buffer.length) {
    refs.sourceBadge.textContent = "Preview"
    return
  }
  refs.sourceBadge.textContent = source === "bluetooth" ? "Bluetooth" : "No Signal"
}

function updateLeadState() {
  refs.leadState.textContent = isDeviceConnected() ? "Nominal" : "Offline"
}

function updateStressMeter(score, label, feedback, note) {
  const clampedScore = clamp(score, 0, 100)
  refs.stressScore.textContent = `${Math.round(clampedScore)}/100`
  refs.stressFill.style.width = `${clampedScore}%`
  refs.stressLabel.textContent = label
  refs.stressFeedback.textContent = feedback
  refs.baselineNote.textContent = note
}

function refreshStressState(sampleWindow) {
  if (!state.baseline.ready) {
    const collectedSeconds = Math.min(state.baseline.samples.length / BASELINE_SAMPLE_COUNT, 1) * (BASELINE_MS / 1000)
    const remainingSeconds = Math.max(0, BASELINE_MS / 1000 - collectedSeconds)
    const feedback = isDeviceConnected()
      ? `Sit relaxed while baseline calibrates. About ${remainingSeconds.toFixed(1)} seconds remaining.`
      : "Connect and sit relaxed for 20 seconds to calibrate your session baseline."
    state.stress.score = 50
    state.stress.label = "Calibrating"
    state.stress.feedback = feedback
    updateStressMeter(50, "Calibrating", feedback, "Baseline target: 50/100")
    return
  }
  if (!sampleWindow.length) {
    state.stress.score = 50
    state.stress.label = "Baseline Ready"
    state.stress.feedback = "Personal baseline saved for this session."
    updateStressMeter(50, "Baseline Ready", "Personal baseline saved for this session.", "Baseline locked until refresh or close.")
    return
  }
  const current = computeSignalFeatures(sampleWindow)
  const baselineActivity = Math.max(1, compositeActivity(state.baseline))
  const currentActivity = compositeActivity(current)
  const relativeDelta = (currentActivity - baselineActivity) / baselineActivity
  const score = clamp(50 + relativeDelta * 38, 0, 100)
  let label = "Balanced"
  let feedback = "You appear close to your personal baseline."
  if (score < 35) {
    label = "Relaxed"
    feedback = "You look relaxed relative to your session baseline."
  } else if (score < 60) {
    label = "Balanced"
    feedback = "You appear close to your personal baseline."
  } else if (score < 78) {
    label = "Elevated"
    feedback = "Stress appears mildly elevated. Consider a brief pause."
  } else {
    label = "High"
    feedback = "Stress appears high. Slow down and take a short break."
  }
  state.stress.score = score
  state.stress.label = label
  state.stress.feedback = feedback
  updateStressMeter(score, label, feedback, "Baseline midpoint: 50/100")
}

function updateTrendLabel() {
  refs.tempTrend.dataset.trend = state.temperatureTrend
  if (state.temperatureTrend === "rising") {
    refs.tempTrendText.textContent = "Rising"
    return
  }
  if (state.temperatureTrend === "falling") {
    refs.tempTrendText.textContent = "Cooling"
    return
  }
  refs.tempTrendText.textContent = "Stable"
}

function resetLiveSessionState() {
  state.liveBuffer = []
  state.displayBuffer = []
  state.liveValue = IDLE_BASELINE
  state.displaySignal = IDLE_BASELINE
  state.signalMean = IDLE_BASELINE
  state.signalVariance = 0
  state.signalDelta = 0
  state.activity = 0
  state.axisMin = -20
  state.axisMax = 20
  state.temperature = DISCONNECTED_TEMPERATURE
  state.displayTemperature = DISCONNECTED_TEMPERATURE
  state.temperatureTrend = "stable"
  refs.signalValue.textContent = IDLE_BASELINE.toFixed(1)
  refs.tempValue.textContent = DISCONNECTED_TEMPERATURE.toFixed(2)
  refs.signalDetail.textContent = "No live signal detected"
}

function setMeasurementIdle() {
  refs.countdownCard.classList.remove("is-running")
  refs.measureButton.disabled = !canStartMeasurement()
  refs.measureButton.textContent = state.baseline.ready ? "Start Measurement" : "Calibrating Baseline"
}

function renderSummary() {
  refs.avgValue.textContent = state.summary.average.toFixed(1)
  refs.peakValue.textContent = state.summary.peak.toFixed(1)
  refs.minValue.textContent = state.summary.minimum.toFixed(1)
  refs.activityLabel.textContent = state.summary.activityLabel
  refs.activityLabel.className = "activity-badge"
  if (state.summary.activityLabel === "Moderate Activity") {
    refs.activityLabel.classList.add("moderate")
  }
  if (state.summary.activityLabel === "High Activity") {
    refs.activityLabel.classList.add("high")
  }
}

function captureBaselineSample(value) {
  if (state.baseline.ready || state.measurement.active) {
    return
  }
  state.baseline.samples.push(value)
  if (state.baseline.samples.length < BASELINE_SAMPLE_COUNT) {
    return
  }
  state.baseline.samples = state.baseline.samples.slice(0, BASELINE_SAMPLE_COUNT)
  Object.assign(state.baseline, computeSignalFeatures(state.baseline.samples), { ready: true })
}

function initChart() {
  const ctx = refs.chartCanvas.getContext("2d")
  const gradient = ctx.createLinearGradient(0, 0, 0, refs.chartCanvas.height || 420)
  gradient.addColorStop(0, "rgba(83, 215, 188, 0.18)")
  gradient.addColorStop(1, "rgba(83, 215, 188, 0)")

  state.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels: Array.from({ length: BUFFER_SIZE }, (_, index) => index),
      datasets: [
        {
          data: state.displayBuffer,
          borderColor: "#53d7bc",
          backgroundColor: gradient,
          borderWidth: 2.6,
          fill: true,
          pointRadius: 0,
          tension: 0.14
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: {
        duration: 180,
        easing: "easeOutCubic"
      },
      interaction: {
        intersect: false,
        mode: "nearest"
      },
      plugins: {
        legend: {
          display: false
        },
        tooltip: {
          enabled: false
        }
      },
      scales: {
        x: {
          display: false,
          grid: {
            display: false
          },
          border: {
            display: false
          }
        },
        y: {
          display: false,
          min: state.axisMin,
          max: state.axisMax,
          grid: {
            display: false
          },
          border: {
            display: false
          }
        }
      },
      elements: {
        line: {
          capBezierPoints: true
        }
      }
    },
    plugins: [glowPlugin]
  })
}

function nextBluetoothValue(now) {
  if (!hasFreshBluetoothSignal(now)) {
    return null
  }
  return state.bluetoothValue
}

function hasFreshBluetoothSignal(now) {
  return Boolean(state.lastIncomingTime && now - state.lastIncomingTime < SIGNAL_TIMEOUT_MS)
}

function parseLeadOffFlag(rawLeadValue) {
  const normalizedLead = String(rawLeadValue ?? "").replace(/\0/g, "").trim()
  return normalizedLead === "1"
}

function relaxIdleState(now) {
  state.liveValue = lerp(state.liveValue, IDLE_BASELINE, 0.16)
  state.displaySignal = lerp(state.displaySignal, IDLE_BASELINE, 0.16)
  state.signalMean = lerp(state.signalMean, IDLE_BASELINE, 0.1)
  state.signalVariance = lerp(state.signalVariance, 0, 0.12)
  state.signalDelta = lerp(state.signalDelta, 0, 0.12)
  state.activity = lerp(state.activity, 0, 0.08)
  state.noiseCurrent = 0
  state.noiseTarget = 0
  state.temperature = lerp(state.temperature, DISCONNECTED_TEMPERATURE, 0.16)
  state.temperatureTrend = "stable"
}

function recordMeasurementSample(value) {
  if (!state.measurement.active) {
    return
  }
  state.measurement.samples.push(value)
}

function finalizeMeasurement() {
  state.measurement.active = false
  state.measurement.completed = true
  state.measurement.revealed = true
  setMeasurementIdle()
  refs.measurementState.textContent = "Measurement complete"
  const samples = state.measurement.samples.slice()
  state.exportSnapshot.buffer = samples.slice()
  state.exportSnapshot.axisMin = state.axisMin
  state.exportSnapshot.axisMax = state.axisMax
  if (!samples.length) {
    resetLiveSessionState()
    return
  }
  const average = samples.reduce((sum, value) => sum + value, 0) / samples.length
  const peak = Math.max(...samples)
  const minimum = Math.min(...samples)
  const variance = samples.reduce((sum, value) => sum + (value - average) ** 2, 0) / samples.length
  const stdev = Math.sqrt(variance)
  const spread = peak - minimum
  const score = spread / Math.max(12, Math.abs(average) * 0.25) + stdev / Math.max(5, Math.abs(average) * 0.12)
  let activityLabel = "Stable"
  if (score >= 1.9) {
    activityLabel = "High Activity"
  } else if (score >= 1.1) {
    activityLabel = "Moderate Activity"
  }
  state.summary.average = average
  state.summary.peak = peak
  state.summary.minimum = minimum
  state.summary.activityLabel = activityLabel
  renderSummary()
  refs.summaryPanel.classList.add("visible")
  refreshStressState(samples)
  resetLiveSessionState()
}

function startMeasurement() {
  if (state.measurement.active || !canStartMeasurement()) {
    return
  }
  refs.summaryPanel.classList.remove("visible")
  state.exportSnapshot.buffer = []
  state.exportSnapshot.axisMin = -20
  state.exportSnapshot.axisMax = 20
  resetLiveSessionState()
  state.measurement.active = true
  state.measurement.completed = false
  state.measurement.revealed = true
  state.measurement.startTime = performance.now()
  state.measurement.samples = []
  state.temperature = IDLE_TEMPERATURE
  state.displayTemperature = IDLE_TEMPERATURE
  state.temperatureTrend = "stable"
  refreshStressState([])
  refs.measurementState.textContent = "Recording in progress"
  refs.measureButton.disabled = true
  refs.measureButton.textContent = "Recording"
  refs.countdownCard.classList.add("is-running")
  refs.countdownValue.textContent = "15.0"
  refs.countdownRing.style.strokeDashoffset = "0"
}

function updateMeasurement(now) {
  if (!state.measurement.active) {
    refs.countdownRing.style.strokeDasharray = `${RING_CIRCUMFERENCE}`
    refs.countdownRing.style.strokeDashoffset = state.measurement.completed ? `${RING_CIRCUMFERENCE}` : "0"
    if (!state.measurement.completed && refs.countdownValue.textContent !== "15.0") {
      refs.countdownValue.textContent = "15.0"
    }
    return
  }
  const elapsed = now - state.measurement.startTime
  const remaining = clamp((MEASUREMENT_MS - elapsed) / 1000, 0, MEASUREMENT_MS / 1000)
  const progress = clamp(elapsed / MEASUREMENT_MS, 0, 1)
  refs.countdownValue.textContent = remaining.toFixed(1)
  refs.countdownRing.style.strokeDasharray = `${RING_CIRCUMFERENCE}`
  refs.countdownRing.style.strokeDashoffset = `${RING_CIRCUMFERENCE * progress}`
  if (elapsed >= MEASUREMENT_MS) {
    refs.countdownValue.textContent = "0.0"
    finalizeMeasurement()
  }
}

function pushSignalSample(value) {
  const previous = state.measurement.samples.length ? state.measurement.samples[state.measurement.samples.length - 1] : value
  recordMeasurementSample(value)
  state.liveBuffer = state.measurement.samples.slice()
  state.liveValue = value
  state.signalMean = lerp(state.signalMean, value, 0.04)
  state.signalVariance = lerp(state.signalVariance, (value - state.signalMean) ** 2, 0.04)
  state.signalDelta = Math.abs(value - previous)
  const span = Math.max(5.5, Math.sqrt(state.signalVariance) * 2.4)
  const intensity = clamp((Math.abs(value - state.signalMean) + state.signalDelta * 1.15) / span, 0, 1.3)
  state.activity = lerp(state.activity, clamp(intensity, 0, 1), 0.08)
  if (performance.now() >= state.noiseShiftAt) {
    state.noiseTarget = randomBetween(-0.05, 0.05)
    state.noiseShiftAt = performance.now() + randomBetween(1600, 3400)
  }
  state.noiseCurrent = lerp(state.noiseCurrent, state.noiseTarget, 0.04)
  const tempTarget = clamp(IDLE_TEMPERATURE + state.activity * 0.76 + state.noiseCurrent, 36.42, 37.4)
  const previousTemp = state.temperature
  state.temperature = lerp(state.temperature, tempTarget, 0.035)
  const temperatureVelocity = state.temperature - previousTemp
  if (temperatureVelocity > 0.0015) {
    state.temperatureTrend = "rising"
  } else if (temperatureVelocity < -0.0015) {
    state.temperatureTrend = "falling"
  } else {
    state.temperatureTrend = "stable"
  }
}

function updateReadouts() {
  state.displaySignal = lerp(state.displaySignal, state.liveValue, 0.16)
  state.displayTemperature = lerp(state.displayTemperature, state.temperature, 0.12)
  refs.signalValue.textContent = state.displaySignal.toFixed(1)
  refs.tempValue.textContent = state.displayTemperature.toFixed(2)
  refs.signalDetail.textContent = state.source === "bluetooth" ? "Live signal from NeuroFront" : "No live signal detected"
  updateTrendLabel()
}

function updateAxisLabels() {
  const axisSource = state.measurement.active
    ? state.measurement.samples
    : state.measurement.completed
      ? state.exportSnapshot.buffer
      : []
  if (!axisSource.length) {
    state.axisMin = lerp(state.axisMin, -20, 0.18)
    state.axisMax = lerp(state.axisMax, 20, 0.18)
  } else {
    let min = Infinity
    let max = -Infinity
    for (const value of axisSource) {
      if (value < min) {
        min = value
      }
      if (value > max) {
        max = value
      }
    }
    const center = (min + max) / 2
    const span = Math.max(26, (max - min) * 1.35)
    const targetMin = center - span / 2
    const targetMax = center + span / 2
    state.axisMin = lerp(state.axisMin, targetMin, 0.18)
    state.axisMax = lerp(state.axisMax, targetMax, 0.18)
  }
  const mid = (state.axisMin + state.axisMax) / 2
  refs.yAxisTop.textContent = `${state.axisMax.toFixed(0)}`
  refs.yAxisMid.textContent = `${mid.toFixed(0)}`
  refs.yAxisBottom.textContent = `${state.axisMin.toFixed(0)}`
  state.chart.options.scales.y.min = state.axisMin
  state.chart.options.scales.y.max = state.axisMax
}

function updateChartState(now) {
  const secondsVisible = MEASUREMENT_MS / 1000
  refs.xAxisStart.textContent = "0s"
  refs.xAxisQuarter.textContent = `${(secondsVisible / 3).toFixed(0)}s`
  refs.xAxisHalf.textContent = `${((secondsVisible * 2) / 3).toFixed(0)}s`
  refs.xAxisEnd.textContent = `${secondsVisible.toFixed(0)}s`
  const live = hasFreshBluetoothSignal(now)
  const revealed = state.measurement.revealed
  const previewVisible = state.measurement.completed && state.exportSnapshot.buffer.length
  if (previewVisible) {
    refs.chartOverlay.textContent = "Latest captured measurement"
  } else if (!revealed) {
    refs.chartOverlay.textContent = "Start measurement to view live trace"
  } else if (!live) {
    refs.chartOverlay.textContent = "Awaiting NeuroFront signal"
  }
  refs.chartOverlay.classList.toggle("is-hidden", previewVisible || (live && revealed))
}

function updateControlsAvailability(now) {
  refs.measureButton.disabled = state.measurement.active || !canStartMeasurement()
  if (!state.measurement.active) {
    refs.measureButton.textContent = state.baseline.ready ? "Start Measurement" : "Calibrating Baseline"
  }
}

function updateChart() {
  updateAxisLabels()
  state.chart.data.datasets[0].hidden = !state.measurement.revealed
  if (state.measurement.active) {
    const padded = state.measurement.samples.slice()
    while (padded.length < BUFFER_SIZE) {
      padded.push(null)
    }
    state.chart.data.datasets[0].data = padded
  } else if (state.measurement.completed && state.exportSnapshot.buffer.length) {
    const padded = state.exportSnapshot.buffer.slice()
    while (padded.length < BUFFER_SIZE) {
      padded.push(null)
    }
    state.chart.data.datasets[0].data = padded
  } else {
    state.chart.data.datasets[0].data = Array(BUFFER_SIZE).fill(null)
  }
  state.chart.update("none")
}

function animationLoop(now) {
  if (!state.lastFrame) {
    state.lastFrame = now
  }
  const delta = now - state.lastFrame
  state.lastFrame = now
  state.sampleAccumulator += delta

  while (state.sampleAccumulator >= SAMPLE_INTERVAL) {
    const bluetoothValue = nextBluetoothValue(now)
    if (state.measurement.active && bluetoothValue !== null) {
      state.source = "bluetooth"
      pushSignalSample(bluetoothValue)
    } else {
      state.source = "idle"
      relaxIdleState(now)
    }
    state.sampleAccumulator -= SAMPLE_INTERVAL
  }

  updateSourceBadge(state.source)
  updateLeadState()
  updateReadouts()
  refreshStressState(state.measurement.active ? state.measurement.samples : state.measurement.completed ? state.exportSnapshot.buffer : [])
  updateChartState(now)
  updateControlsAvailability(now)
  updateMeasurement(now)
  updateChart()
  requestAnimationFrame(animationLoop)
}

function drawExportChart(ctx, width, height, buffer, axisMin, axisMax) {
  const outerPad = 72
  const plotLeft = outerPad + 42
  const plotRight = width - 48
  const plotTop = 58
  const plotBottom = height - 82
  const plotWidth = plotRight - plotLeft
  const plotHeight = plotBottom - plotTop
  const safeMin = Number.isFinite(axisMin) ? axisMin : -20
  const safeMax = Number.isFinite(axisMax) ? axisMax : 20
  const span = Math.max(1, safeMax - safeMin)
  const mid = safeMin + span / 2
  const points = buffer.length ? buffer : [0]

  ctx.fillStyle = "#121924"
  ctx.fillRect(0, 0, width, height)

  ctx.fillStyle = "#0a0f17"
  ctx.strokeStyle = "rgba(138, 160, 186, 0.12)"
  ctx.lineWidth = 2
  const radius = 26
  ctx.beginPath()
  ctx.moveTo(plotLeft + radius, plotTop)
  ctx.lineTo(plotRight - radius, plotTop)
  ctx.quadraticCurveTo(plotRight, plotTop, plotRight, plotTop + radius)
  ctx.lineTo(plotRight, plotBottom - radius)
  ctx.quadraticCurveTo(plotRight, plotBottom, plotRight - radius, plotBottom)
  ctx.lineTo(plotLeft + radius, plotBottom)
  ctx.quadraticCurveTo(plotLeft, plotBottom, plotLeft, plotBottom - radius)
  ctx.lineTo(plotLeft, plotTop + radius)
  ctx.quadraticCurveTo(plotLeft, plotTop, plotLeft + radius, plotTop)
  ctx.closePath()
  ctx.fill()
  ctx.stroke()

  ctx.strokeStyle = "rgba(138, 160, 186, 0.08)"
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(plotLeft, plotTop + plotHeight / 2)
  ctx.lineTo(plotRight, plotTop + plotHeight / 2)
  ctx.stroke()

  ctx.fillStyle = "rgba(172, 186, 204, 0.82)"
  ctx.font = "500 28px Inter, system-ui, sans-serif"
  ctx.textAlign = "right"
  ctx.textBaseline = "middle"
  ctx.fillText(safeMax.toFixed(0), plotLeft - 22, plotTop + 14)
  ctx.fillText(mid.toFixed(0), plotLeft - 22, plotTop + plotHeight / 2)
  ctx.fillText(safeMin.toFixed(0), plotLeft - 22, plotBottom - 14)

  ctx.font = "500 24px Inter, system-ui, sans-serif"
  ctx.textAlign = "center"
  ctx.textBaseline = "top"
  ctx.fillText(refs.xAxisStart.textContent, plotLeft + 12, plotBottom + 20)
  ctx.fillText(refs.xAxisQuarter.textContent, plotLeft + plotWidth * 0.33, plotBottom + 20)
  ctx.fillText(refs.xAxisHalf.textContent, plotLeft + plotWidth * 0.66, plotBottom + 20)
  ctx.fillText(refs.xAxisEnd.textContent, plotRight - 12, plotBottom + 20)

  ctx.save()
  ctx.beginPath()
  ctx.rect(plotLeft, plotTop, plotWidth, plotHeight)
  ctx.clip()

  ctx.strokeStyle = "#53d7bc"
  ctx.lineWidth = 5
  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  ctx.shadowColor = "rgba(83, 215, 188, 0.34)"
  ctx.shadowBlur = 18
  ctx.beginPath()
  for (let index = 0; index < points.length; index += 1) {
    const x = plotLeft + (index / Math.max(1, BUFFER_SIZE - 1)) * plotWidth
    const y = plotTop + (1 - (points[index] - safeMin) / span) * plotHeight
    if (index === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  }
  ctx.stroke()
  ctx.restore()
}

function exportChartAsPng() {
  if (!state.chart) {
    return
  }
  const exportCanvas = document.createElement("canvas")
  exportCanvas.width = 1600
  exportCanvas.height = 980
  const ctx = exportCanvas.getContext("2d")
  const buffer = state.measurement.completed ? state.exportSnapshot.buffer : state.liveBuffer
  const axisMin = state.measurement.completed ? state.exportSnapshot.axisMin : state.axisMin
  const axisMax = state.measurement.completed ? state.exportSnapshot.axisMax : state.axisMax
  drawExportChart(ctx, exportCanvas.width, exportCanvas.height, buffer, axisMin, axisMax)
  const link = document.createElement("a")
  link.href = exportCanvas.toDataURL("image/png", 1)
  link.download = `neurofront-${new Date().toISOString().replace(/[:.]/g, "-")}.png`
  link.click()
}

function handleDisconnect() {
  const hasCompletedPreview = state.measurement.completed && state.exportSnapshot.buffer.length
  if (state.characteristic) {
    state.characteristic.removeEventListener("characteristicvaluechanged", handleCharacteristic)
  }
  if (state.device) {
    state.device.removeEventListener("gattserverdisconnected", handleDisconnect)
  }
  state.device = null
  state.characteristic = null
  state.lastIncomingTime = 0
  state.leadOff = false
  state.source = "idle"
  state.temperature = DISCONNECTED_TEMPERATURE
  state.displayTemperature = DISCONNECTED_TEMPERATURE
  state.temperatureTrend = "stable"
  state.measurement.active = false
  if (!hasCompletedPreview) {
    state.exportSnapshot.buffer = []
    state.exportSnapshot.axisMin = -20
    state.exportSnapshot.axisMax = 20
    state.measurement.completed = false
    state.measurement.revealed = false
  } else {
    state.measurement.completed = true
    state.measurement.revealed = true
  }
  refs.connectButton.textContent = "Connect"
  refs.measurementState.textContent = "Ready for 15 second capture"
  refs.countdownValue.textContent = "15.0"
  if (!hasCompletedPreview) {
    refs.summaryPanel.classList.remove("visible")
  }
  resetLiveSessionState()
  refreshStressState([])
  setMeasurementIdle()
  setStatus("disconnected")
}

function handleCharacteristic(event) {
  const raw = new TextDecoder().decode(event.target.value).replace(/\0/g, "").trim()
  const parts = raw.split(",")
  const valueText = parts[0] ?? ""
  const parsedValue = Number.parseFloat(valueText)
  state.lastIncomingTime = performance.now()
  if (Number.isFinite(parsedValue)) {
    state.bluetoothValue = parsedValue
    captureBaselineSample(parsedValue)
  }
  state.leadOff = false
  setStatus("connected")
}

async function startNotifications(characteristic) {
  let lastError = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await characteristic.startNotifications()
      return
    } catch (error) {
      lastError = error
      await new Promise((resolve) => {
        setTimeout(resolve, 180)
      })
    }
  }
  throw lastError
}

async function connectBluetooth() {
  if (!navigator.bluetooth) {
    setStatus("disconnected")
    return
  }
  refs.connectButton.disabled = true
  refs.connectButton.textContent = "Connecting..."
  setStatus("connecting")
  try {
    if (state.characteristic) {
      state.characteristic.removeEventListener("characteristicvaluechanged", handleCharacteristic)
      state.characteristic = null
    }
    if (state.device) {
      state.device.removeEventListener("gattserverdisconnected", handleDisconnect)
      if (state.device.gatt && state.device.gatt.connected) {
        state.device.gatt.disconnect()
      }
      state.device = null
    }
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ name: DEVICE_NAME }, { namePrefix: DEVICE_NAME }],
      optionalServices: [SERVICE_UUID]
    })
    if (!device.gatt) {
      throw new Error("GATT unavailable")
    }
    state.device = device
    device.addEventListener("gattserverdisconnected", handleDisconnect)
    const server = device.gatt.connected ? device.gatt : await device.gatt.connect()
    refs.connectButton.textContent = "Reconnect"
    setStatus("connected")
    const service = await server.getPrimaryService(SERVICE_UUID)
    const characteristic = await service.getCharacteristic(CHAR_UUID)
    state.characteristic = characteristic
    characteristic.addEventListener("characteristicvaluechanged", handleCharacteristic)
    await startNotifications(characteristic)
  } catch (error) {
    handleDisconnect()
  } finally {
    refs.connectButton.disabled = false
  }
}

function bindEvents() {
  refs.connectButton.addEventListener("click", connectBluetooth)
  refs.measureButton.addEventListener("click", startMeasurement)
  refs.exportButton.addEventListener("click", exportChartAsPng)
}

function init() {
  refs.countdownRing.style.strokeDasharray = `${RING_CIRCUMFERENCE}`
  refs.countdownRing.style.strokeDashoffset = "0"
  initChart()
  bindEvents()
  setStatus("disconnected")
  renderSummary()
  refreshStressState([])
  updateChartState(performance.now())
  updateControlsAvailability(performance.now())
  requestAnimationFrame(() => {
    document.body.classList.add("is-ready")
  })
  requestAnimationFrame(animationLoop)
}

init()
