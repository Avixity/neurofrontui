(() => {
  const DATABASE = "neurofront-captures"
  const STORE = "captures"
  const PAGE_SIZE = 6
  const elements = Object.fromEntries([
    "historyList", "historyEmpty", "historyStatus", "historyRetry", "historyLoadMore",
    "captureDialog", "captureClose", "captureDate", "captureScore", "captureCategory",
    "captureActivity", "captureAverage", "capturePeak", "captureMinimum", "captureDuration",
    "captureBaselineDate", "captureBaselineFeatures", "captureGraph", "captureBaselineGraph", "captureExport",
    "captureDelete", "captureDeleteDialog", "captureDeleteDate", "captureDeleteStatus", "captureDeleteCancel", "captureDeleteConfirm"
  ].map(id => [id, document.getElementById(id)]))
  const records = new Map()
  const pending = new Map()
  const saving = new Map()
  const savedIds = new Set()
  let databasePromise = null
  let loading = null
  let cursor = null
  let hasMore = false
  let readFailed = false
  let selected = null
  let latestCapture = null
  let returnFocus = null
  let accountOwner = null
  let scopeVersion = 0
  let visibleCount = PAGE_SIZE
  const guestPending = new Map()
  const guestDeleted = new Set()
  let deleteTarget = null
  let deleteBusy = false
  let deleteFailed = false
  let historyNotice = ""

  const dictionary = () => window.NEUROFRONT_TRANSLATIONS[document.documentElement.lang] || window.NEUROFRONT_TRANSLATIONS.en
  const t = (key, values = {}) => (dictionary()[key] || window.NEUROFRONT_TRANSLATIONS.en[key] || key)
    .replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match)
  const translatedLabel = source => {
    const key = Object.keys(window.NEUROFRONT_TRANSLATIONS.en).find(key => window.NEUROFRONT_TRANSLATIONS.en[key] === source)
    return key ? t(key) : source
  }
  const formatDate = date => Number.isFinite(Date.parse(date))
    ? new Intl.DateTimeFormat(document.documentElement.lang, { dateStyle: "medium", timeStyle: "short" }).format(new Date(date))
    : t("history.notAvailable")
  const copy = value => JSON.parse(JSON.stringify(value))
  const sorted = values => values.sort((a, b) => b.completedAt.localeCompare(a.completedAt) || b.id.localeCompare(a.id))
  const featureNames = ["mean", "rms", "stdDev", "peakToPeak", "derivativeMean"]

  function validCapture(record) {
    const trace = values => Array.isArray(values) && values.length > 0 && values.length <= 10000 && values.every(Number.isFinite)
    return Boolean(record && typeof record.id === "string" && record.id.length < 100 && record.schemaVersion === 1 &&
      Number.isFinite(Date.parse(record.startedAt)) && Number.isFinite(Date.parse(record.completedAt)) &&
      Number.isFinite(record.durationMs) && record.durationMs > 0 && record.durationMs <= 3600000 &&
      Number.isFinite(record.sampleIntervalMs) && record.sampleIntervalMs > 0 && record.unit === "uV" &&
      trace(record.samples) && Number.isFinite(record.axisMin) && Number.isFinite(record.axisMax) &&
      record.axisMax > record.axisMin && Number.isFinite(record.stress?.score) &&
      record.stress.score >= 0 && record.stress.score <= 100 && typeof record.stress.label === "string" &&
      ["average", "peak", "minimum"].every(key => Number.isFinite(record.summary?.[key])) &&
      typeof record.summary.activityLabel === "string" && trace(record.baseline?.samples) &&
      featureNames.every(key => Number.isFinite(record.baseline[key])) &&
      Number.isFinite(record.baseline.durationMs) && record.baseline.durationMs > 0 &&
      Number.isFinite(record.baseline.sampleIntervalMs) && record.baseline.sampleIntervalMs > 0)
  }

  function openDatabase() {
    if (databasePromise) return databasePromise
    databasePromise = new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error("IndexedDB unavailable")); return }
      const request = indexedDB.open(DATABASE, 1)
      let settled = false
      const timeout = setTimeout(() => fail(new Error("Storage timeout")), 8000)
      const fail = error => { if (!settled) { settled = true; clearTimeout(timeout); reject(error) } }
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE, { keyPath: "id" })
        store.createIndex("completed", ["completedAt", "id"])
      }
      request.onerror = () => fail(request.error)
      request.onblocked = () => fail(new Error("Storage blocked"))
      request.onsuccess = () => {
        const db = request.result
        if (settled) { db.close(); return }
        settled = true
        clearTimeout(timeout)
        db.onversionchange = () => { db.close(); databasePromise = null }
        resolve(db)
      }
    }).catch(error => { databasePromise = null; throw error })
    return databasePromise
  }

  async function storeCapture(record) {
    const db = await openDatabase()
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite")
      transaction.objectStore(STORE).put(record)
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error || new Error("Storage interrupted"))
    })
  }

  async function deleteGuestCapture(id) {
    await saving.get(id)
    const db = await openDatabase()
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite")
      transaction.objectStore(STORE).delete(id)
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error || new Error("Storage interrupted"))
    })
    guestDeleted.add(id)
    guestPending.delete(id)
  }

  async function readPage(after) {
    const db = await openDatabase()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly")
      const range = after ? IDBKeyRange.upperBound(after, true) : null
      const request = transaction.objectStore(STORE).index("completed").openCursor(range, "prev")
      const page = []
      let nextCursor = after
      let more = false
      let invalid = false
      request.onsuccess = () => {
        const item = request.result
        if (!item) return
        if (!validCapture(item.value)) { invalid = true; item.continue(); return }
        if (page.length === PAGE_SIZE) { more = true; return }
        page.push(item.value)
        nextCursor = item.key
        item.continue()
      }
      transaction.oncomplete = () => resolve({ page, nextCursor, more, invalid })
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error || new Error("Storage interrupted"))
    })
  }

  async function loadPage(reset = false) {
    if (accountOwner) {
      if (reset) visibleCount = Math.max(PAGE_SIZE, visibleCount)
      else visibleCount += PAGE_SIZE
      const account = window.NeuroFrontAccount.getState()
      records.clear(); pending.clear(); savedIds.clear()
      const captures = sorted(account.captures.filter(validCapture))
      for (const record of captures.slice(0, visibleCount)) {
        records.set(record.id, record)
        if (record.cloudSaved) savedIds.add(record.id)
        else pending.set(record.id, record)
      }
      hasMore = captures.length > visibleCount
      readFailed = Boolean(account.error && !captures.length)
      renderList()
      return
    }
    const version = scopeVersion
    if (loading) {
      await loading
      if (!reset) return
    }
    loading = (async () => {
      try {
        const result = await readPage(reset ? null : cursor)
        if (version !== scopeVersion) return
        if (reset) records.clear()
        for (const record of result.page) if (!guestDeleted.has(record.id)) { records.set(record.id, record); savedIds.add(record.id) }
        cursor = result.nextCursor
        hasMore = result.more
        readFailed = result.invalid
      } catch { if (version === scopeVersion) readFailed = true }
    })()
    renderList()
    await loading
    if (version !== scopeVersion) return
    loading = null
    renderList()
  }

  function renderList() {
    const focusedId = document.activeElement?.dataset.captureId
    const focusedDeleteId = document.activeElement?.dataset.deleteCaptureId
    const all = new Map(records)
    for (const [id, record] of pending) all.set(id, record)
    elements.historyList.replaceChildren()
    for (const record of sorted([...all.values()])) {
      const entry = document.createElement("li")
      entry.className = "history-entry"
      const content = document.createElement("div")
      content.className = "history-entry-copy"
      const date = document.createElement("time")
      date.dateTime = record.completedAt
      date.textContent = formatDate(record.completedAt)
      const meta = document.createElement("p")
      meta.className = "history-entry-meta"
      const score = document.createElement("strong")
      score.textContent = `${Math.round(record.stress.score)}/100`
      const category = document.createElement("span")
      category.textContent = translatedLabel(record.stress.label)
      meta.append(score, category)
      content.append(date, meta)
      if (pending.has(record.id)) {
        const status = document.createElement("small")
        status.textContent = t(accountOwner ? "account.sync.pending" : saving.has(record.id) ? "history.saving" : "history.notSaved")
        content.append(status)
      }
      const button = document.createElement("button")
      button.type = "button"
      button.className = "history-info-button"
      button.textContent = "i"
      button.dataset.captureId = record.id
      button.setAttribute("aria-label", `${t("history.view")}: ${formatDate(record.completedAt)}`)
      button.setAttribute("aria-haspopup", "dialog")
      button.setAttribute("aria-controls", "captureDialog")
      button.addEventListener("click", () => openCapture(record, button))
      const remove = document.createElement("button")
      remove.type = "button"
      remove.className = "history-info-button history-delete-button"
      remove.dataset.deleteCaptureId = record.id
      remove.title = t("history.delete")
      remove.setAttribute("aria-label", `${t("history.delete")}: ${formatDate(record.completedAt)}`)
      remove.setAttribute("aria-haspopup", "dialog")
      remove.setAttribute("aria-controls", "captureDeleteDialog")
      const icon = svgNode("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", "stroke-width": 1.6, "aria-hidden": true })
      icon.append(svgNode("path", { d: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7" }))
      remove.append(icon)
      remove.addEventListener("click", () => requestDelete(record, remove))
      const actions = document.createElement("div")
      actions.className = "history-entry-actions"
      actions.append(button, remove)
      entry.append(content, actions)
      elements.historyList.append(entry)
    }
    elements.historyEmpty.hidden = all.size > 0 || readFailed || Boolean(loading)
    elements.historyList.setAttribute("aria-busy", String(Boolean(loading)))
    elements.historyLoadMore.hidden = !hasMore
    elements.historyLoadMore.disabled = Boolean(loading)
    const failedSaves = pending.size > saving.size
    elements.historyRetry.hidden = !failedSaves && !readFailed
    elements.historyRetry.disabled = Boolean(saving.size || loading)
    const account = accountOwner ? window.NeuroFrontAccount?.getState() : null
    const status = account ? account.conflict ? "account.error.conflict" : account.pendingCaptureDeletes?.length ? "history.deletePending" : account.error ? "account.sync.error" : account.pending ? "account.sync.pending" : historyNotice : failedSaves ? "history.saveFailed" : readFailed ? "history.loadFailed" : saving.size ? "history.saving" : loading ? "history.loading" : historyNotice
    elements.historyStatus.textContent = status ? t(status) : ""
    if (account?.pendingCaptureDeletes?.length) elements.historyRetry.hidden = false
    if ((focusedId || focusedDeleteId) && !elements.captureDialog.open && !elements.captureDeleteDialog.open) {
      [...elements.historyList.querySelectorAll("button")].find(button => focusedDeleteId ? button.dataset.deleteCaptureId === focusedDeleteId : button.dataset.captureId === focusedId)?.focus({ preventScroll: true })
    }
  }

  async function persist(record) {
    const version = scopeVersion
    if (saving.has(record.id)) return saving.get(record.id)
    const work = (async () => {
      try {
        await storeCapture(record)
        guestPending.delete(record.id)
        if (version !== scopeVersion) return
        savedIds.add(record.id)
        pending.delete(record.id)
        records.set(record.id, record)
      } catch {
        guestPending.set(record.id, record)
        if (version === scopeVersion) pending.set(record.id, record)
      } finally {
        if (version === scopeVersion) { saving.delete(record.id); renderList() }
      }
    })()
    saving.set(record.id, work)
    renderList()
    return work
  }

  function recordCapture(snapshot) {
    if (!validCapture(snapshot) || savedIds.has(snapshot.id) || pending.has(snapshot.id) || (!accountOwner && guestDeleted.has(snapshot.id))) return
    historyNotice = ""
    const record = copy(snapshot)
    latestCapture = record
    document.dispatchEvent(new CustomEvent("neurofront:capture-completed", { detail: { id: record.id } }))
    if (accountOwner) {
      const id = accountOwner, version = scopeVersion
      records.set(record.id, record); pending.set(record.id, record); renderList()
      window.NeuroFrontAccount.saveCapture(record, id).catch(() => {
        if (version === scopeVersion) { pending.set(record.id, record); renderList() }
      })
      return
    }
    pending.set(record.id, record)
    guestPending.set(record.id, record)
    persist(record).then(() => { if (savedIds.has(record.id)) loadPage(true) })
  }

  function svgNode(name, attributes, text) {
    const element = document.createElementNS("http://www.w3.org/2000/svg", name)
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value))
    if (text !== undefined) element.textContent = text
    return element
  }

  function drawTrace(svg, samples, durationMs, intervalMs, minimum, maximum, reference = false) {
    svg.replaceChildren()
    svg.setAttribute("viewBox", "0 0 720 300")
    svg.setAttribute("aria-label", t(reference ? "history.reference" : "history.graph"))
    const left = 62, top = 28, width = 630, height = 204
    const span = maximum > minimum ? maximum - minimum : 1
    const count = Math.max(1, durationMs / intervalMs - 1)
    for (let index = 0; index < 3; index++) {
      const y = top + height * index / 2
      svg.append(svgNode("line", { x1: left, x2: left + width, y1: y, y2: y, stroke: "currentColor", opacity: 0.15 }))
      svg.append(svgNode("text", { x: left - 12, y: y + 5, "text-anchor": "end", fill: "currentColor", "font-size": 14 }, formatSignalValue(maximum - span * index / 2, span, 1)))
    }
    for (let index = 0; index < 4; index++) {
      svg.append(svgNode("text", { x: left + width * index / 3, y: top + height + 26, "text-anchor": "middle", fill: "currentColor", "font-size": 14 }, `${(durationMs / 1000 * index / 3).toFixed(0)}s`))
    }
    svg.append(svgNode("text", { x: left, y: 16, fill: "currentColor", "font-size": 13 }, t("history.units")))
    svg.append(svgNode("text", { x: left + width / 2, y: 286, "text-anchor": "middle", fill: "currentColor", "font-size": 14 }, t("history.elapsed")))
    const defs = svgNode("defs", {})
    const clip = svgNode("clipPath", { id: `${svg.id}-clip` })
    clip.append(svgNode("rect", { x: left, y: top, width, height }))
    defs.append(clip)
    svg.append(defs)
    const points = samples.map((value, index) => `${index ? "L" : "M"}${(left + Math.min(1, index / count) * width).toFixed(2)},${(top + (1 - (value - minimum) / span) * height).toFixed(2)}`).join(" ")
    svg.append(svgNode("path", { d: points, fill: "none", stroke: reference ? "#aebdce" : "#53d7bc", "stroke-width": reference ? 1.5 : 2, "stroke-linejoin": "round", "stroke-dasharray": reference ? "5 4" : "none", "clip-path": `url(#${svg.id}-clip)` }))
  }

  function renderCapture() {
    if (!selected) return
    const record = selected
    elements.captureDate.textContent = formatDate(record.completedAt)
    elements.captureScore.textContent = `${Math.round(record.stress.score)}/100`
    elements.captureCategory.textContent = translatedLabel(record.stress.label)
    elements.captureActivity.textContent = translatedLabel(record.summary.activityLabel)
    elements.captureActivity.className = "activity-badge" + (record.summary.activityLabel === "High Activity" ? " high" : record.summary.activityLabel === "Moderate Activity" ? " moderate" : "")
    elements.captureAverage.textContent = record.summary.average.toFixed(1)
    elements.capturePeak.textContent = record.summary.peak.toFixed(1)
    elements.captureMinimum.textContent = record.summary.minimum.toFixed(1)
    elements.captureDuration.textContent = `${record.durationMs / 1000}s · ${t("history.samples", { count: record.samples.length })}`
    elements.captureBaselineDate.textContent = formatDate(record.baseline.createdAt)
    elements.captureBaselineFeatures.replaceChildren()
    const details = [
      ...featureNames.map(key => [t(`history.${key}`), `${record.baseline[key].toFixed(2)} ${record.baseline.unit}`]),
      [t("history.baselineDuration"), `${record.baseline.durationMs / 1000}s · ${t("history.samples", { count: record.baseline.samples.length })}`],
      [t("history.algorithm"), record.calculationVersion]
    ]
    for (const [name, value] of details) {
      const group = document.createElement("div"), label = document.createElement("dt"), detail = document.createElement("dd")
      label.textContent = name
      detail.textContent = value
      group.append(label, detail)
      elements.captureBaselineFeatures.append(group)
    }
    drawTrace(elements.captureGraph, record.samples, record.durationMs, record.sampleIntervalMs, record.axisMin, record.axisMax)
    const low = Math.min(...record.baseline.samples), high = Math.max(...record.baseline.samples)
    const pad = Math.max(2, (high - low) * 0.12)
    drawTrace(elements.captureBaselineGraph, record.baseline.samples, record.baseline.durationMs, record.baseline.sampleIntervalMs, low - pad, high + pad, true)
  }

  function openCapture(record, button) {
    selected = copy(record)
    returnFocus = { element: button, id: record.id }
    renderCapture()
    elements.captureDialog.showModal()
    elements.captureDialog.scrollTop = 0
    elements.captureClose.focus({ preventScroll: true })
  }

  function renderDelete() {
    if (!deleteTarget) return
    elements.captureDeleteDate.textContent = t("history.deleteDate", { date: formatDate(deleteTarget.record.completedAt) })
    elements.captureDeleteStatus.textContent = deleteBusy ? t("history.deleting") : deleteFailed ? t("history.deleteFailed") : ""
    elements.captureDeleteConfirm.disabled = deleteBusy
    elements.captureDeleteDialog.setAttribute("aria-busy", String(deleteBusy))
  }

  function requestDelete(record, button) {
    if (deleteBusy) return
    deleteTarget = { record: copy(record), button, owner: accountOwner, version: scopeVersion }
    deleteFailed = false
    renderDelete()
    elements.captureDeleteDialog.showModal()
    elements.captureDeleteCancel.focus({ preventScroll: true })
  }

  async function confirmDelete() {
    if (!deleteTarget || deleteBusy) return
    const target = deleteTarget
    if (target.version !== scopeVersion || target.owner !== accountOwner) return
    deleteBusy = true; deleteFailed = false; renderDelete()
    try {
      if (target.owner) await window.NeuroFrontAccount.deleteCapture(target.record.id, target.owner)
      else await deleteGuestCapture(target.record.id)
      if (target.version !== scopeVersion) return
      records.delete(target.record.id); pending.delete(target.record.id); savedIds.delete(target.record.id)
      if (latestCapture?.id === target.record.id) latestCapture = null
      historyNotice = "history.deleted"
      document.dispatchEvent(new CustomEvent("neurofront:capture-deleted", { detail: { id: target.record.id, owner: target.owner } }))
      if (selected?.id === target.record.id) elements.captureDialog.close()
      elements.captureDeleteDialog.close()
      await loadPage(true)
      if (target.version === scopeVersion && !elements.captureDialog.open && !elements.captureDeleteDialog.open) {
        const next = elements.historyList.querySelector(".history-delete-button") || document.getElementById("historyTitle")
        next.focus({ preventScroll: true })
      }
    } catch {
      if (target.version === scopeVersion) { deleteFailed = true; historyNotice = "history.deleteFailed"; renderList() }
    } finally {
      if (target.version === scopeVersion) { deleteBusy = false; renderDelete() }
    }
  }

  function exportCapture() {
    if (!selected) return
    const record = selected
    const canvas = document.createElement("canvas")
    canvas.width = 1600
    canvas.height = 1240
    const context = canvas.getContext("2d")
    context.fillStyle = "#121924"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = "#f4f7fb"
    context.font = "600 32px Inter, system-ui, sans-serif"
    context.fillText(`NeuroFront · ${t("history.details")}`, 72, 58, 1460)
    context.font = "400 25px Inter, system-ui, sans-serif"
    context.fillText(`${formatDate(record.completedAt)} · ${record.durationMs / 1000}s`, 72, 104, 1460)
    context.fillText(`${Math.round(record.stress.score)}/100 · ${translatedLabel(record.stress.label)} · ${translatedLabel(record.summary.activityLabel)}`, 72, 150, 1460)
    context.fillText(`${t("summary.average")}: ${record.summary.average.toFixed(1)} · ${t("summary.peak")}: ${record.summary.peak.toFixed(1)} · ${t("summary.minimum")}: ${record.summary.minimum.toFixed(1)} ${record.unit}`, 72, 196, 1460)
    context.fillText(`${t("history.baseline")}: ${formatDate(record.baseline.createdAt)} · ${record.calculationVersion}`, 72, 242, 1460)
    context.save()
    context.translate(0, 260)
    const labels = [0, 1, 2, 3].map(index => `${(record.durationMs / 1000 * index / 3).toFixed(0)}s`)
    drawExportChart(context, 1600, 980, record.samples, record.axisMin, record.axisMax, labels, record.durationMs / record.sampleIntervalMs)
    context.restore()
    const link = document.createElement("a")
    link.href = canvas.toDataURL("image/png", 1)
    link.download = `neurofront-${record.completedAt.replace(/[:.]/g, "-")}.png`
    link.click()
  }

  elements.historyLoadMore.addEventListener("click", () => loadPage())
  elements.historyRetry.addEventListener("click", async () => {
    if (accountOwner) { await window.NeuroFrontAccount.retry().catch(() => {}); await loadPage(true); return }
    await Promise.all([...pending.values()].map(persist))
    await loadPage(true)
  })
  elements.captureClose.addEventListener("click", () => elements.captureDialog.close())
  elements.captureExport.addEventListener("click", exportCapture)
  elements.captureDelete.addEventListener("click", () => { if (selected) requestDelete(selected, elements.captureDelete) })
  elements.captureDeleteConfirm.addEventListener("click", confirmDelete)
  elements.captureDeleteCancel.addEventListener("click", () => elements.captureDeleteDialog.close())
  elements.captureDeleteDialog.addEventListener("keydown", event => {
    if (event.key !== "Tab") return
    const first = elements.captureDeleteCancel
    const last = deleteBusy ? first : elements.captureDeleteConfirm
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  })
  elements.captureDeleteDialog.addEventListener("close", () => {
    const target = deleteTarget
    const replacement = [...elements.historyList.querySelectorAll(".history-delete-button")].find(button => button.dataset.deleteCaptureId === target?.record.id)
    const focus = target?.button.isConnected ? target.button : replacement || document.getElementById("historyTitle")
    if (target?.version === scopeVersion) focus?.focus({ preventScroll: true })
    if (!deleteBusy) deleteTarget = null
  })
  elements.captureDialog.addEventListener("keydown", event => {
    if (event.key !== "Tab") return
    const controls = [...elements.captureDialog.querySelectorAll('button:not(:disabled), [tabindex="0"]')]
      .filter(element => !element.hidden && element.getClientRects().length)
    const first = controls[0], last = controls[controls.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  })
  elements.captureDialog.addEventListener("click", event => {
    if (event.target !== elements.captureDialog) return
    const rect = elements.captureDialog.getBoundingClientRect()
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) elements.captureDialog.close()
  })
  elements.captureDialog.addEventListener("close", () => {
    const replacement = [...elements.historyList.querySelectorAll("button")].find(button => button.dataset.captureId === returnFocus?.id)
    const target = returnFocus?.element.isConnected ? returnFocus.element : replacement || document.getElementById("historyLoadMore")
    target?.focus({ preventScroll: true })
    selected = null
  })
  document.addEventListener("neurofront:languagechange", () => { renderList(); renderCapture(); renderDelete() })
  async function readAssistantHistory(capture) {
    if (accountOwner) {
      const account = window.NeuroFrontAccount.getState()
      return { previous: copy(sorted(account.captures.filter(record => validCapture(record) && record.id !== capture.id && record.completedAt < capture.completedAt)).slice(0, 120)), historyAvailable: !account.error || account.captures.length > 0 }
    }
    try {
      const db = await openDatabase()
      const previous = await new Promise((resolve, reject) => {
        const result = []
        const transaction = db.transaction(STORE, "readonly")
        const range = IDBKeyRange.upperBound([capture.completedAt, ""], true)
        const request = transaction.objectStore(STORE).index("completed").openCursor(range, "prev")
        request.onsuccess = () => {
          const item = request.result
          if (!item) return
          if (validCapture(item.value) && item.value.id !== capture.id) result.push(item.value)
          if (result.length < 120) item.continue()
        }
        transaction.oncomplete = () => resolve(result)
        transaction.onerror = () => reject(transaction.error)
        transaction.onabort = () => reject(transaction.error)
      })
      const unique = new Map(previous.map(record => [record.id, record]))
      for (const record of pending.values()) if (record.id !== capture.id && record.completedAt < capture.completedAt) unique.set(record.id, record)
      return { previous: copy(sorted([...unique.values()]).slice(0, 120)), historyAvailable: true }
    } catch { return { previous: [], historyAvailable: false } }
  }
  document.getElementById("captureExplain").addEventListener("click", () => {
    if (!selected) return
    const record = copy(selected)
    elements.captureDialog.close()
    window.NeuroFrontAssistant?.explain(record)
  })
  async function readGuestCaptures() {
    const db = await openDatabase()
    const saved = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).getAll()
      request.onsuccess = () => resolve(request.result.filter(validCapture))
      request.onerror = () => reject(request.error)
    })
    const all = new Map(saved.map(record => [record.id, record]))
    for (const [id, record] of guestPending) all.set(id, record)
    return copy(sorted([...all.values()]))
  }
  document.addEventListener("neurofront:accountreset", event => {
    scopeVersion++
    accountOwner = event.detail.nextOwner
    elements.captureDeleteDialog.close()
    deleteTarget = null; deleteBusy = false; deleteFailed = false; historyNotice = ""
    if (elements.captureDialog.open) elements.captureDialog.close()
    records.clear(); pending.clear(); saving.clear(); savedIds.clear()
    latestCapture = null; selected = null; cursor = null; hasMore = false; readFailed = false; loading = null; visibleCount = PAGE_SIZE
    if (!accountOwner) for (const [id, record] of guestPending) pending.set(id, record)
    renderList()
  })
  document.addEventListener("neurofront:accountrecords", event => {
    if (event.detail.owner === accountOwner) loadPage(true)
  })
  document.addEventListener("neurofront:accountchange", () => {
    const label = document.querySelector('[data-i18n="history.local"]')
    if (label) window.NeuroFrontI18n.setMessage(label, accountOwner ? "account.history.cloud" : "history.local")
    if (accountOwner) renderList()
  })
  window.NeuroFrontHistory = Object.freeze({ record: recordCapture, getLatest: () => latestCapture && copy(latestCapture), readAssistantHistory, validCapture, readGuestCaptures })
  loadPage(true)
})()
