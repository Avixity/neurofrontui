(() => {
  "use strict"
  const ids = ["assistantLauncher", "assistantPanel", "assistantClose", "assistantNewChat", "assistantContext", "assistantContextText", "assistantClearContext", "assistantMessages", "assistantStatus", "assistantRetry", "assistantNotice", "assistantNoticeClose", "assistantForm", "assistantInput", "assistantSend", "assistantStop", "getMeasurementExplanation", "captureExplain"]
  const ui = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]))
  const features = ["mean", "rms", "stdDev", "peakToPeak", "derivativeMean"]
  const allowedResources = new Set(window.NEUROFRONT_RESOURCES.map(resource => resource.id))
  const messages = []
  const account = () => window.NeuroFrontAccount
  const owner = () => account()?.owner() || null
  const newId = () => crypto.randomUUID()
  let threadId = newId(), threadOwner = owner(), revision = 0
  let selected = null, request = null, retry = null, statusKey = "", origin = null, generation = 0
  let notice = null
  const noticePauses = new Set()
  const lang = () => document.documentElement.lang || "en"
  const t = (key, values = {}) => (window.NEUROFRONT_TRANSLATIONS[lang()]?.[key] || window.NEUROFRONT_TRANSLATIONS.en[key] || key).replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match)
  const date = value => Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat(lang(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : t("history.notAvailable")
  const number = value => new Intl.NumberFormat(lang(), { maximumFractionDigits: 1 }).format(value)
  const isCurrent = expected => owner() === expected && (!account()?.isCurrent || account().isCurrent(expected))

  function preset(capture) {
    return `${t(`assistant.preset.${window.NeuroFrontScore.classify(capture.stress.score).id}`, { score: Math.round(capture.stress.score) })} ${t("assistant.reference", { date: date(capture.baseline.createdAt) })} ${t("assistant.experimental")}`
  }
  function messageText(message) {
    if (message.kind === "request" && message.status !== "completed") return t(message.status === "pending" ? "assistant.loading" : message.status === "stopped" ? "assistant.messageStopped" : "assistant.messageFailed")
    if (message.kind === "safety") return t("assistant.safety")
    if (message.kind === "preset" && message.capture) return preset(message.capture)
    if (message.kind === "explain" && message.capture) return t("assistant.explainMessage", { date: date(message.capture.completedAt) })
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
    return message.content || ""
  }
  function append(message) {
    const value = { id: newId(), status: "completed", createdAt: new Date().toISOString(), ...message }
    value.content = messageText(value)
    messages.push(value)
    return value
  }
  function getSnapshot() {
    const first = messages.find(message => message.role === "user")
    return {
      id: threadId, title: (first ? messageText(first) : t("assistant.newChat")).slice(0, 120), capture_id: selected?.id || null,
      revision, updated_at: new Date().toISOString(), messages: messages.map(message => {
        const { capture, job, ...stored } = message
        return { ...structuredClone(stored), content: messageText(message), ...(capture ? { captureId: capture.id } : {}) }
      })
    }
  }
  function persist() {
    if (!threadOwner || !isCurrent(threadOwner) || !messages.length || !account()?.saveThread) return
    const snapshot = getSnapshot()
    Promise.resolve(account().saveThread(snapshot, threadOwner)).catch(() => {})
  }
  function resourceLink(id) {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "assistant-resource-link"
    button.textContent = t(`resources.${id}.title`)
    button.addEventListener("click", () => window.NeuroFrontResources.open(id, button))
    return button
  }
  function clearNotice() {
    if (notice?.timer) clearTimeout(notice.timer)
    notice = null
    noticePauses.clear()
  }
  function dismissNotice() {
    if (!notice || notice.dismissed) return
    clearTimeout(notice.timer)
    notice.dismissed = true
    if (ui.assistantNotice?.contains(document.activeElement)) {
      ui.assistantMessages.querySelector(`[data-retry-id="${notice.messageId}"]`)?.focus({ preventScroll: true })
    }
    renderStatus()
  }
  function pauseNotice(source, paused) {
    if (!notice || notice.dismissed) return
    if (notice.timer) {
      clearTimeout(notice.timer)
      notice.remaining = Math.max(0, notice.remaining - (performance.now() - notice.started))
      notice.timer = null
    }
    if (paused) noticePauses.add(source)
    else noticePauses.delete(source)
    scheduleNotice()
  }
  function scheduleNotice() {
    if (!notice || notice.dismissed || notice.timer || noticePauses.size || ui.assistantPanel.hidden) return
    if (notice.remaining <= 0) { dismissNotice(); return }
    notice.started = performance.now()
    notice.timer = setTimeout(dismissNotice, notice.remaining)
  }
  function showNotice(messageId) {
    clearNotice()
    notice = { messageId, remaining: 5000, started: 0, timer: null, dismissed: false }
    if (ui.assistantNotice?.matches(":hover")) noticePauses.add("notice-hover")
    if (ui.assistantNotice?.contains(document.activeElement)) noticePauses.add("notice-focus")
    scheduleNotice()
  }
  function renderStatus() {
    const dismissed = statusKey === "assistant.unavailable" && notice?.dismissed
    ui.assistantStatus.textContent = statusKey && !dismissed ? t(statusKey) : ""
    ui.assistantRetry.hidden = !retry || Boolean(request) || Boolean(dismissed)
    if (ui.assistantNoticeClose) ui.assistantNoticeClose.hidden = statusKey !== "assistant.unavailable" || Boolean(dismissed)
  }
  function retryFor(message) {
    if (message.job) return message.job
    const data = message.retryJob
    if (!data) return null
    const capture = data.captureId ? (account()?.getState()?.captures || []).find(item => item.id === data.captureId) || (selected?.id === data.captureId ? selected : null) : null
    return { ...structuredClone(data), capture, missingCapture: Boolean(data.captureId && !capture), replyId: message.id }
  }
  function render() {
    const nearBottom = ui.assistantMessages.scrollHeight - ui.assistantMessages.scrollTop - ui.assistantMessages.clientHeight < 100
    const focusedRetry = document.activeElement?.dataset.retryId
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
      element.dataset.messageId = message.id
      element.dataset.status = message.status
      const paragraph = document.createElement("p")
      paragraph.dir = "auto"
      paragraph.textContent = messageText(message)
      element.append(paragraph)
      for (const id of message.resourceIds || []) if (allowedResources.has(id)) element.append(resourceLink(id))
      if (["failed", "stopped", "cancelled"].includes(message.status) && message.retryJob) {
        const button = document.createElement("button")
        button.type = "button"
        button.className = "text-button assistant-message-retry"
        button.dataset.retryId = message.id
        button.textContent = t("assistant.retry")
        button.disabled = Boolean(request)
        button.addEventListener("click", () => { const job = retryFor(message); if (job) respond(job) })
        for (const [event, paused] of [["pointerenter", true], ["pointerleave", false]]) button.addEventListener(event, () => { if (notice?.messageId === message.id) pauseNotice("retry-hover", paused) })
        button.addEventListener("focus", () => { if (notice?.messageId === message.id) pauseNotice("retry-focus", true) })
        button.addEventListener("blur", () => { if (notice?.messageId === message.id) pauseNotice("retry-focus", false) })
        element.append(button)
      }
      ui.assistantMessages.append(element)
    }
    const privacy = document.createElement("p")
    privacy.className = "assistant-privacy"
    privacy.textContent = t(threadOwner ? "assistant.accountPrivacy" : "assistant.privacy")
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
    renderStatus()
    ui.assistantStop.hidden = !request
    ui.assistantSend.disabled = Boolean(request)
    ui.assistantClearContext.disabled = Boolean(request)
    ui.getMeasurementExplanation.disabled = Boolean(request)
    ui.captureExplain.disabled = Boolean(request)
    if (focusedRetry) ui.assistantMessages.querySelector(`[data-retry-id="${focusedRetry}"]`)?.focus({ preventScroll: true })
    if (nearBottom) ui.assistantMessages.scrollTop = ui.assistantMessages.scrollHeight
  }
  function open() {
    if (ui.assistantPanel.hidden) origin = document.activeElement
    ui.assistantPanel.hidden = false
    ui.assistantLauncher.setAttribute("aria-expanded", "true")
    updateViewport()
    scheduleNotice()
    requestAnimationFrame(() => ui.assistantInput.focus({ preventScroll: true }))
  }
  function minimize() {
    pauseNotice("hidden", true)
    ui.assistantPanel.hidden = true
    noticePauses.delete("hidden")
    ui.assistantLauncher.setAttribute("aria-expanded", "false")
    ;(origin?.isConnected && !origin.closest("dialog:not([open])") ? origin : ui.assistantLauncher).focus({ preventScroll: true })
  }
  function stop() {
    if (!request) return
    request.controller.abort()
    const message = messages.find(item => item.id === request.replyId)
    if (message) message.status = "stopped"
    request = null
    generation++
    clearNotice()
    statusKey = "assistant.stopped"
    persist()
    render()
  }
  function clearThread() {
    generation++
    request?.controller.abort()
    request = null
    messages.length = 0
    selected = null
    retry = null
    statusKey = ""
    clearNotice()
    threadId = newId()
    threadOwner = owner()
    revision = 0
    ui.assistantInput.value = ""
  }
  function reset() {
    stop()
    persist()
    clearThread()
    render()
    ui.assistantInput.focus({ preventScroll: true })
  }
  function resetForAccount() {
    clearThread()
    ui.getMeasurementExplanation.hidden = true
    ui.assistantPanel.hidden = true
    ui.assistantLauncher.setAttribute("aria-expanded", "false")
    render()
  }
  function restoreThread(thread, captures = []) {
    if (!thread || !Array.isArray(thread.messages) || !owner()) return
    stop()
    clearThread()
    threadId = thread.id
    revision = thread.revision || 0
    selected = captures.find(item => item.id === thread.capture_id) || null
    for (const stored of thread.messages) {
      if (!stored || !["user", "assistant"].includes(stored.role) || typeof stored.id !== "string") continue
      const message = structuredClone(stored)
      if (message.captureId) message.capture = captures.find(item => item.id === message.captureId) || null
      if (message.status === "pending") message.status = "failed"
      messages.push(message)
    }
    const lastFailed = [...messages].reverse().find(message => ["failed", "stopped", "cancelled"].includes(message.status) && message.retryJob)
    retry = lastFailed ? retryFor(lastFailed) : null
    render()
    open()
    if (thread.messages.some(message => message.status === "pending")) persist()
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
    if (request || !isCurrent(threadOwner)) return
    const currentGeneration = ++generation
    const expectedOwner = threadOwner
    const controller = new AbortController()
    let responseMessage = messages.find(message => message.id === job.replyId)
    if (!responseMessage) responseMessage = append({ role: "assistant", kind: "request", status: "pending", ...(job.capture ? { captureId: job.capture.id } : {}) })
    job.replyId = responseMessage.id
    responseMessage.status = "pending"
    responseMessage.kind = "request"
    responseMessage.job = job
    responseMessage.retryJob = { captureId: job.capture?.id || job.captureId || null, explanation: Boolean(job.explanation), comparisonShown: Boolean(job.comparisonShown), dialogue: structuredClone(job.dialogue) }
    request = { controller, replyId: responseMessage.id }
    retry = job
    clearNotice()
    statusKey = "assistant.loading"
    persist()
    render()
    const timeout = setTimeout(() => controller.abort(), 30000)
    try {
      if (job.missingCapture) throw new Error("Capture unavailable")
      const context = job.context === undefined ? await contextFor(job.capture) : job.context
      if (currentGeneration !== generation || !isCurrent(expectedOwner)) return
      if (controller.signal.aborted) throw new Error("Unavailable")
      job.context = context
      if (job.explanation && !job.comparisonShown && context) {
        const comparison = append({ role: "assistant", kind: "comparison", comparison: window.NeuroFrontScore.compareCaptures(context.selected, context.previous, context.historyAvailable), ...(job.capture ? { captureId: job.capture.id } : {}) })
        messages.splice(messages.indexOf(comparison), 1)
        messages.splice(messages.indexOf(responseMessage), 0, comparison)
        job.comparisonShown = responseMessage.retryJob.comparisonShown = true
        persist()
        render()
      }
      const headers = { "Content-Type": "application/json" }
      const body = { language: lang(), messages: job.dialogue, context: expectedOwner ? null : context }
      if (expectedOwner) {
        if (job.capture && account().captureSaved && !account().captureSaved(job.capture.id)) throw new Error("Capture pending")
        const token = await account().accessToken()
        if (currentGeneration !== generation || !isCurrent(expectedOwner)) return
        if (!token) throw new Error("Unavailable")
        headers.Authorization = `Bearer ${token}`
        body.accountCaptureId = job.capture?.id || null
      }
      const response = await fetch("/api/assistant", { method: "POST", headers, signal: controller.signal, body: JSON.stringify(body) })
      const result = await response.json()
      if (currentGeneration !== generation || !isCurrent(expectedOwner)) return
      if (response.status === 422 && result.error?.code === "unsafe_request") {
        Object.assign(responseMessage, { kind: "safety", status: "completed", resourceIds: ["readings", "habits"], content: t("assistant.safety") })
        delete responseMessage.retryJob
        delete responseMessage.job
        retry = null
        statusKey = ""
        return
      }
      if (!response.ok || !validResponse(result)) throw new Error("Unavailable")
      Object.assign(responseMessage, { kind: "reply", status: "completed", content: result.paragraphs.join("\n\n"), resourceIds: result.resourceIds })
      delete responseMessage.retryJob
      delete responseMessage.job
      retry = null
      statusKey = ""
    } catch {
      if (currentGeneration !== generation || !isCurrent(expectedOwner)) return
      responseMessage.status = "failed"
      statusKey = job.capture ? "assistant.unavailable" : "assistant.genericUnavailable"
      if (statusKey === "assistant.unavailable") showNotice(responseMessage.id)
    } finally {
      clearTimeout(timeout)
      if (currentGeneration === generation && isCurrent(expectedOwner)) { request = null; persist(); render() }
    }
  }
  function dialogue() {
    return messages.filter(message => message.status === "completed" && !["preset", "comparison", "request"].includes(message.kind)).slice(-8).map(message => ({ role: message.role, content: messageText(message).slice(0, 1200) }))
  }
  function explain(capture) {
    if (request || !capture) return
    if (selected?.id !== capture.id) { persist(); clearThread() }
    selected = structuredClone(capture)
    append({ role: "user", kind: "explain", capture: selected })
    append({ role: "assistant", kind: "preset", capture: selected })
    persist()
    render()
    open()
    respond({ capture: selected, explanation: true, dialogue: dialogue() })
  }
  function send() {
    if (request) return
    const content = ui.assistantInput.value.trim()
    if (!content) return
    if (content.length > 1200) { clearNotice(); statusKey = "assistant.tooLong"; render(); return }
    append({ role: "user", content, ...(selected ? { captureId: selected.id } : {}) })
    ui.assistantInput.value = ""
    persist()
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
  ui.assistantNoticeClose?.addEventListener("click", dismissNotice)
  ui.assistantNotice?.addEventListener("pointerenter", () => pauseNotice("notice-hover", true))
  ui.assistantNotice?.addEventListener("pointerleave", () => pauseNotice("notice-hover", false))
  ui.assistantNotice?.addEventListener("focusin", () => pauseNotice("notice-focus", true))
  ui.assistantNotice?.addEventListener("focusout", () => queueMicrotask(() => pauseNotice("notice-focus", ui.assistantNotice.contains(document.activeElement))))
  ui.assistantForm.addEventListener("submit", event => { event.preventDefault(); send() })
  ui.assistantInput.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) { event.preventDefault(); send() }
  })
  ui.assistantPanel.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); minimize() } })
  ui.getMeasurementExplanation.addEventListener("click", () => explain(window.NeuroFrontHistory.getLatest()))
  document.addEventListener("neurofront:capture-completed", () => { ui.getMeasurementExplanation.hidden = false })
  document.addEventListener("neurofront:accountreset", resetForAccount)
  document.addEventListener("neurofront:threadselect", event => restoreThread(event.detail?.thread, event.detail?.captures || account()?.getState()?.captures || []))
  document.addEventListener("neurofront:languagechange", () => {
    if (request) stop()
    if (retry) retry.dialogue = dialogue()
    render()
  })
  window.visualViewport?.addEventListener("resize", updateViewport)
  window.visualViewport?.addEventListener("scroll", updateViewport)
  window.addEventListener("resize", updateViewport)
  window.NeuroFrontAssistant = Object.freeze({ explain, getSnapshot, restoreThread, resetForAccount, captureStarted() { ui.getMeasurementExplanation.hidden = true } })
  render()
})()
