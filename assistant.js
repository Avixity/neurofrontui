(() => {
  "use strict"
  const ids = ["assistantLauncher", "assistantPanel", "assistantClose", "assistantNewChat", "assistantContext", "assistantContextText", "assistantClearContext", "assistantMessages", "assistantStatus", "assistantRetry", "assistantForm", "assistantInput", "assistantSend", "assistantStop", "getMeasurementExplanation", "captureExplain"]
  const ui = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]))
  const features = ["mean", "rms", "stdDev", "peakToPeak", "derivativeMean"]
  const allowedResources = new Set(window.NEUROFRONT_RESOURCES.map(resource => resource.id))
  const messages = []
  let selected = null
  let request = null
  let retry = null
  let statusKey = ""
  let origin = null
  let generation = 0
  const lang = () => document.documentElement.lang || "en"
  const t = (key, values = {}) => (window.NEUROFRONT_TRANSLATIONS[lang()]?.[key] || window.NEUROFRONT_TRANSLATIONS.en[key] || key).replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match)
  const date = value => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(lang(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : t("history.notAvailable")
  const number = value => new Intl.NumberFormat(lang(), { maximumFractionDigits: 1 }).format(value)

  function preset(capture) {
    return `${t(`assistant.preset.${window.NeuroFrontScore.classify(capture.stress.score).id}`, { score: Math.round(capture.stress.score) })} ${t("assistant.reference", { date: date(capture.baseline.createdAt) })} ${t("assistant.experimental")}`
  }
  function messageText(message) {
    if (message.kind === "safety") return t("assistant.safety")
    if (message.kind === "preset") return preset(message.capture)
    if (message.kind === "explain") return t("assistant.explainMessage", { date: date(message.capture.completedAt) })
    if (message.kind === "comparison") {
      const comparison = message.comparison
      if (comparison.status === "unavailable") return t("assistant.historyUnavailable")
      if (comparison.status === "none") return t("assistant.noPrevious")
      if (comparison.status !== "available") return t("assistant.noComparable")
      const delta = comparison.difference > 0 ? "+" + number(comparison.difference) : number(comparison.difference)
      let text = t("assistant.comparison", { count: number(comparison.count), from: date(comparison.from), to: date(comparison.to), average: number(comparison.average), difference: delta })
      if (comparison.trend) text += " " + t(comparison.trend === "increasing" ? "assistant.trendUp" : comparison.trend === "decreasing" ? "assistant.trendDown" : "assistant.trendMixed")
      return text
    }
    return message.content
  }
  function resourceLink(id) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "assistant-resource-link"
    button.textContent = t(`resources.${id}.title`)
    button.addEventListener("click", () => window.NeuroFrontResources.open(id, button))
    return button
  }
  function render() {
    const nearBottom = ui.assistantMessages.scrollHeight - ui.assistantMessages.scrollTop - ui.assistantMessages.clientHeight < 100
    ui.assistantMessages.replaceChildren()
    if (!messages.length) {
      const welcome = document.createElement("p")
      welcome.className = "assistant-welcome"
      welcome.textContent = t("assistant.welcome")
      ui.assistantMessages.append(welcome)
      const starters = document.createElement("div")
      starters.className = "assistant-starters"
      for (const id of ["getting-started", "baseline", "readings"]) starters.append(resourceLink(id))
      ui.assistantMessages.append(starters)
    }
    for (const message of messages) {
      const element = document.createElement("div")
      element.className = `assistant-message ${message.role}${message.kind === "preset" ? " preset" : ""}`
      element.dataset.role = message.role
      element.dataset.kind = message.kind || "reply"
      const paragraph = document.createElement("p")
      paragraph.dir = "auto"
      paragraph.textContent = messageText(message)
      element.append(paragraph)
      for (const id of message.resourceIds || []) if (allowedResources.has(id)) element.append(resourceLink(id))
      ui.assistantMessages.append(element)
    }
    const privacy = document.createElement("p")
    privacy.className = "assistant-privacy"
    privacy.textContent = t("assistant.privacy")
    ui.assistantMessages.append(privacy)
    if (retry && !request) {
      const resources = document.createElement("div")
      resources.className = "assistant-starters"
      for (const id of ["baseline", "placement", "habits"]) resources.append(resourceLink(id))
      ui.assistantMessages.append(resources)
    }
    ui.assistantInput.placeholder = t("assistant.placeholder")
    ui.assistantContext.hidden = !selected
    ui.assistantContextText.textContent = selected ? t("assistant.selected", { date: date(selected.completedAt), score: Math.round(selected.stress.score) }) : ""
    ui.assistantStatus.textContent = statusKey ? t(statusKey) : ""
    ui.assistantRetry.hidden = !retry || Boolean(request)
    ui.assistantStop.hidden = !request
    ui.assistantSend.disabled = Boolean(request)
    ui.assistantClearContext.disabled = Boolean(request)
    ui.getMeasurementExplanation.disabled = Boolean(request)
    ui.captureExplain.disabled = Boolean(request)
    if (nearBottom) ui.assistantMessages.scrollTop = ui.assistantMessages.scrollHeight
  }
  function open() {
    if (ui.assistantPanel.hidden) origin = document.activeElement
    ui.assistantPanel.hidden = false
    ui.assistantLauncher.setAttribute("aria-expanded", "true")
    updateViewport()
    requestAnimationFrame(() => ui.assistantInput.focus({ preventScroll: true }))
  }
  function minimize() {
    ui.assistantPanel.hidden = true
    ui.assistantLauncher.setAttribute("aria-expanded", "false")
    ;(origin?.isConnected && !origin.closest("dialog:not([open])") ? origin : ui.assistantLauncher).focus({ preventScroll: true })
  }
  function stop() {
    if (!request) return
    request.controller.abort()
    request = null
    generation++
    statusKey = "assistant.stopped"
    render()
  }
  function reset() {
    stop()
    messages.length = 0
    selected = null
    retry = null
    statusKey = ""
    ui.assistantInput.value = ""
    render()
    ui.assistantInput.focus({ preventScroll: true })
  }
  async function summary(capture) {
    const baseline = capture.baseline
    const baselineFeatures = Object.fromEntries(features.map(key => [key, baseline[key]]))
    const canonical = JSON.stringify([baseline.createdAt, baseline.calculationVersion, baseline.unit, baseline.sampleIntervalMs, baseline.durationMs, features.map(key => baseline[key]), baseline.samples])
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))
    const fingerprint = [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("")
    return {
      id: capture.id, completedAt: capture.completedAt, durationMs: capture.durationMs,
      score: capture.stress.score, categoryId: window.NeuroFrontScore.classify(capture.stress.score).id,
      calculationVersion: capture.calculationVersion, unit: capture.unit, sampleCount: capture.samples.length,
      summary: { average: capture.summary.average, peak: capture.summary.peak, minimum: capture.summary.minimum, activityLabel: capture.summary.activityLabel },
      baseline: { createdAt: baseline.createdAt, calculationVersion: baseline.calculationVersion, unit: baseline.unit,
        sampleIntervalMs: baseline.sampleIntervalMs, durationMs: baseline.durationMs, features: baselineFeatures, fingerprint }
    }
  }
  async function contextFor(capture) {
    if (!capture) return null
    const current = await summary(capture)
    const history = await window.NeuroFrontHistory.readAssistantHistory(capture)
    const previous = await Promise.all(history.previous.map(summary))
    const compatible = previous.filter(record => window.NeuroFrontScore.compatible(current, record))
    const incompatible = previous.filter(record => !window.NeuroFrontScore.compatible(current, record))
    return { selected: current, previous: [...compatible, ...incompatible].slice(0, 12), historyAvailable: history.historyAvailable }
  }
  function validResponse(result) {
    return result && Array.isArray(result.paragraphs) && result.paragraphs.length >= 1 && result.paragraphs.length <= 4 &&
      result.paragraphs.every(text => typeof text === "string" && text.length <= 2400 && !/[<>]|https?:|data:|javascript:|!\[|\{\{/i.test(text)) &&
      Array.isArray(result.resourceIds) && result.resourceIds.length <= 3 && result.resourceIds.every(id => allowedResources.has(id))
  }
  async function respond(job) {
    if (request) return
    const currentGeneration = ++generation
    const controller = new AbortController()
    request = { controller }
    retry = job
    statusKey = "assistant.loading"
    render()
    const timeout = setTimeout(() => controller.abort(), 30000)
    try {
      const context = job.context === undefined ? await contextFor(job.capture) : job.context
      if (currentGeneration !== generation) return
      if (controller.signal.aborted) throw new Error("Unavailable")
      job.context = context
      if (job.explanation && !job.comparisonShown && context) {
        messages.push({ role: "assistant", kind: "comparison", comparison: window.NeuroFrontScore.compareCaptures(context.selected, context.previous, context.historyAvailable) })
        job.comparisonShown = true
        render()
      }
      const response = await fetch("/api/assistant", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ language: lang(), messages: job.dialogue, context })
      })
      const result = await response.json()
      if (currentGeneration !== generation) return
      if (response.status === 422 && result.error?.code === "unsafe_request") {
        messages.push({ role: "assistant", kind: "safety", resourceIds: ["readings", "habits"] })
        retry = null
        statusKey = ""
        return
      }
      if (!response.ok || !validResponse(result)) throw new Error("Unavailable")
      if (currentGeneration !== generation) return
      result.paragraphs.forEach((content, index) => messages.push({ role: "assistant", content, resourceIds: index === result.paragraphs.length - 1 ? result.resourceIds : [] }))
      retry = null
      statusKey = ""
    } catch {
      if (currentGeneration !== generation) return
      statusKey = job.capture ? "assistant.unavailable" : "assistant.genericUnavailable"
    } finally {
      clearTimeout(timeout)
      if (currentGeneration === generation) { request = null; render() }
    }
  }
  function dialogue() {
    return messages.filter(message => !["preset", "comparison"].includes(message.kind)).slice(-8).map(message => ({ role: message.role, content: messageText(message).slice(0, 1200) }))
  }
  function explain(capture) {
    if (request || !capture) return
    if (selected?.id !== capture.id) { messages.length = 0; retry = null }
    selected = structuredClone(capture)
    messages.push({ role: "user", kind: "explain", capture: selected })
    messages.push({ role: "assistant", kind: "preset", capture: selected })
    render()
    open()
    respond({ capture: selected, explanation: true, dialogue: dialogue() })
  }
  function send() {
    if (request) return
    const content = ui.assistantInput.value.trim()
    if (!content) return
    if (content.length > 1200) { statusKey = "assistant.tooLong"; render(); return }
    messages.push({ role: "user", content })
    ui.assistantInput.value = ""
    respond({ capture: selected, explanation: false, dialogue: dialogue() })
  }
  function updateViewport() {
    const viewport = window.visualViewport
    const height = viewport?.height || window.innerHeight
    const bottom = Math.max(0, window.innerHeight - height - (viewport?.offsetTop || 0))
    ui.assistantPanel.style.setProperty("--assistant-viewport-height", `${height}px`)
    ui.assistantPanel.style.setProperty("--assistant-viewport-bottom", `${bottom}px`)
    ui.assistantPanel.classList.toggle("is-keyboard-open", bottom > 120)
  }
  ui.assistantLauncher.addEventListener("click", () => ui.assistantPanel.hidden ? open() : minimize())
  ui.assistantClose.addEventListener("click", minimize)
  ui.assistantNewChat.addEventListener("click", reset)
  ui.assistantClearContext.addEventListener("click", reset)
  ui.assistantStop.addEventListener("click", stop)
  ui.assistantRetry.addEventListener("click", () => { if (retry) respond(retry) })
  ui.assistantForm.addEventListener("submit", event => { event.preventDefault(); send() })
  ui.assistantInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); send() }
  })
  ui.assistantPanel.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); minimize() } })
  ui.getMeasurementExplanation.addEventListener("click", () => explain(window.NeuroFrontHistory.getLatest()))
  document.addEventListener("neurofront:capture-completed", () => { ui.getMeasurementExplanation.hidden = false })
  document.addEventListener("neurofront:languagechange", () => {
    if (request) stop()
    if (retry) retry.dialogue = dialogue()
    render()
  })
  window.visualViewport?.addEventListener("resize", updateViewport)
  window.visualViewport?.addEventListener("scroll", updateViewport)
  window.addEventListener("resize", updateViewport)
  window.NeuroFrontAssistant = Object.freeze({ explain, captureStarted() { ui.getMeasurementExplanation.hidden = true } })
  render()
})()
