(() => {
  "use strict"
  const prefix = "neurofront.adaptiveHistory.v1."
  const maxRecords = 50
  const windowMs = 15000
  const presets = [0, 300000, 600000]
  const ui = Object.fromEntries(["adaptiveArchive", "adaptiveArchiveList", "adaptiveArchiveEmpty", "adaptiveArchiveStatus"]
    .map(id => [id, document.getElementById(id)]))
  const resolved = () => window.NeuroFrontAccount?.sessionResolved?.() === true
  const owner = () => window.NeuroFrontAccount?.owner?.() || null
  const key = id => prefix + (id === null ? "guest" : "owner." + encodeURIComponent(id))
  const syncPrefix = "neurofront.adaptiveSync.v1."
  const validId = id => typeof id === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
  const accountPrefix = id => syncPrefix + encodeURIComponent(id) + "."
  const consentKey = id => accountPrefix(id) + "enabled"
  const opPrefix = id => accountPrefix(id) + "outbox."
  const opKey = (id, record) => opPrefix(id) + record
  const permitted = id => Boolean(id && localStorage.getItem(consentKey(id)) === "true")
  const dictionary = () => window.NEUROFRONT_TRANSLATIONS[document.documentElement.lang] || window.NEUROFRONT_TRANSLATIONS.en
  const translate = (name, values = {}) => (dictionary()["dash." + name] || window.NEUROFRONT_TRANSLATIONS.en["dash." + name] || name)
    .replace(/\{(\w+)\}/g, (match, key) => values[key] ?? match)
  function valid(row) {
    return row?.type === "adaptive" && Number.isSafeInteger(row.completedAt) && row.completedAt >= 0 &&
      row.completedAt < 8640000000000000 && Number.isSafeInteger(row.durationMs) &&
      Number.isSafeInteger(row.count) && row.count > 0 && Math.floor(row.durationMs / windowMs) === row.count &&
      Number.isInteger(row.score) && row.score >= 0 && row.score <= 100 &&
      (row.custom === true ? Number.isSafeInteger(row.presetMs) && row.presetMs % 60000 === 0 && row.presetMs >= 60000 && row.presetMs <= 3600000 :
        row.custom === undefined && presets.includes(row.presetMs)) &&
      (row.end === "timer" ? row.presetMs > 0 && row.durationMs === row.presetMs :
        row.end === "manual" && (row.presetMs === 0 || row.durationMs < row.presetMs))
  }
  const compact = ({type, completedAt, durationMs, presetMs, end, count, score, custom,id}) => ({type, completedAt, durationMs, presetMs, end, count, score, ...(validId(id) ? {id} : {}), ...(custom === true ? {custom} : {})})
  function read(id) {
    const raw = localStorage.getItem(key(id))
    if (!raw) return []
    if (raw.length > 24000) throw new Error("Adaptive history exceeds its storage limit")
    const rows = JSON.parse(raw)
    if (!Array.isArray(rows)) throw new Error("Invalid Adaptive history")
    return rows.slice(0, maxRecords).filter(valid).map(compact)
  }
  const remoteRecord = row => compact({type:"adaptive", id:row.id, completedAt:row.completed_at_ms, durationMs:row.duration_ms, presetMs:row.preset_ms, end:row.ended, count:row.window_count, score:row.score, custom:row.custom || undefined})
  const savePayload = row => ({p_id:row.id, p_completed_at_ms:row.completedAt, p_duration_ms:row.durationMs, p_preset_ms:row.presetMs, p_ended:row.end, p_window_count:row.count, p_score:row.score, p_custom:row.custom === true})
  const canSync = id => id && resolved() && owner() === id && typeof window.NeuroFrontAccount.adaptiveSync === "function"
  function outbox(id) {
    const prefix = opPrefix(id), entries = []
    for (let at=0; at<localStorage.length; at++) {
      const name = localStorage.key(at)
      if (!name?.startsWith(prefix)) continue
      const recordId = name.slice(prefix.length), raw = localStorage.getItem(name)
      if (!validId(recordId) || !raw) continue
      try {
        const op = JSON.parse(raw)
        if (op.type === "remove" || (op.type === "save" && valid(op.row) && op.row.id === recordId)) entries.push({name,recordId,raw,op})
      } catch {}
    }
    return entries
  }
  function queue(id, row, type) {
    localStorage.setItem(opKey(id,row.id),JSON.stringify(type === "save" ? {type,row:compact(row)} : {type}))
  }
  const remoteKey = id => accountPrefix(id) + "synced"
  let hasFreshRemote = false, cursor = null, hasMore = false
  let remote = [], paused = false, syncFailure = false, work = null, active
  function flush(older = false) {
    const id = owner()
    if (!canSync(id) || work || (older && !hasMore)) return
    const session = active, signal = session.signal
    work = (async () => {
      try {
        const sync = (operation, payload) => window.NeuroFrontAccount.adaptiveSync(operation,payload,id,signal)
        for (const entry of older ? [] : outbox(id)) {
          if (signal.aborted || !canSync(id)) return
          if (localStorage.getItem(entry.name) !== entry.raw) continue
          if (entry.op.type === "save" && !permitted(id)) {
            localStorage.removeItem(entry.name)
            continue
          }
          await sync(entry.op.type, entry.op.type === "save" ? savePayload(entry.op.row) : {p_id:entry.recordId})
          if (signal.aborted || !canSync(id)) return
          if (localStorage.getItem(entry.name) === entry.raw) {
            if (entry.op.type === "save") {
              const existing = JSON.parse(localStorage.getItem(remoteKey(id)) || "[]")
              const ids = new Set([...read(id).map(row=>row.id), entry.recordId])
              localStorage.setItem(remoteKey(id), JSON.stringify([entry.recordId,...existing.filter(key=>key!==entry.recordId && ids.has(key))]))
            }
            localStorage.removeItem(entry.name)
          }
        }
        const rows = await sync("list", older ? cursor : {})
        if (!Array.isArray(rows)) throw new Error("Invalid Adaptive sync response")
        if (signal.aborted || !canSync(id)) return
        const page = rows.slice(0,maxRecords).map(remoteRecord).filter(row=>valid(row) && validId(row.id))
        hasMore = rows.length > maxRecords && page.length === maxRecords
        const tail = page.at(-1)
        cursor = tail ? {p_before_ms:tail.completedAt,p_before_id:tail.id} : null
        if (older) {
          const ids = new Set(remote.map(row=>row.id))
          remote = [...remote, ...page.filter(row=>!ids.has(row.id))]
        } else remote = page
        hasFreshRemote = true
        syncFailure = false
        // An acknowledged cached row absent from the covered cloud range was removed.
        // Persist eviction so a subsequent offline reload cannot redisplay it.
        const known = new Set(JSON.parse(localStorage.getItem(remoteKey(id)) || "[]"))
        if (known.size) {
          const found = new Set(remote.map(row=>row.id))
          const latestLocal = read(id)
          const afterCursor = row => cursor && (row.completedAt > cursor.p_before_ms ||
            (row.completedAt === cursor.p_before_ms && row.id >= cursor.p_before_id))
          const kept = latestLocal.filter(row=>!known.has(row.id) || found.has(row.id) || (hasMore && !afterCursor(row)))
          if (kept.length !== latestLocal.length) localStorage.setItem(key(id),JSON.stringify(kept))
        }
      } catch {
        if (!signal.aborted && canSync(id)) syncFailure = true
      }
    })().finally(() => {
      if (active !== session) return
      work = null
      render()
      if (paused) { paused = false; flush() }
    })
  }
  function remove(row) {
    const id = owner()
    if (!canSync(id) || !validId(row.id)) return
    try {
      queue(id,row,"remove")
      localStorage.setItem(key(id), JSON.stringify(read(id).filter(record=>record.id !== row.id)))
      render()
      if (work) paused = true
      else flush()
    } catch { syncFailure=true; render() }
  }
  function save(value, id) {
    if (!resolved() || owner() !== id || !valid(value)) return false
    try {
      const prior = read(id)
      const upload = Boolean(canSync(id) && permitted(id) && globalThis.crypto?.randomUUID)
      const row = compact(upload ? {...value,id:crypto.randomUUID()} : value)
      const next = [row, ...prior].slice(0, maxRecords)
      localStorage.setItem(key(id), JSON.stringify(next))
      if (upload) {
        try { queue(id,row,"save"); if (work) paused=true; else flush() } catch { syncFailure=true }
      }
    } catch { return false }
    render()
    return true
  }
  function formatDuration(duration) {
    const seconds = Math.floor(duration / 1000)
    const format = new Intl.NumberFormat(document.documentElement.lang, { minimumIntegerDigits: 2, useGrouping: false })
    return [Math.floor(seconds / 60), seconds % 60].map(number => format.format(number)).join(":")
  }
  function renderRow(row) {
    const entry = document.createElement("li"), date = document.createElement("time"), main = document.createElement("p"),
      estimate = document.createElement("strong"), elapsed = document.createElement("span"), coverage = document.createElement("small")
    const locale = document.documentElement.lang
    const format = new Intl.NumberFormat(locale)
    date.dateTime = new Date(row.completedAt).toISOString()
    date.textContent = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(row.completedAt)
    estimate.textContent = translate("adaptiveEntryScore", {score:format.format(row.score)})
    const mode = row.custom ? translate("customPreset", {minutes: format.format(row.presetMs / 60000)}) : translate(row.presetMs === 0 ? "unlimited" : row.presetMs === 300000 ? "five" : "ten")
    const ended = row.end === "timer" ? "" : " · " + translate(row.presetMs ? "adaptiveEntryEarly" : "adaptiveEntryManual")
    elapsed.textContent = translate("adaptiveEntryElapsed", {duration:formatDuration(row.durationMs)}) + " · " + mode + ended
    coverage.textContent = translate("coverageElapsed", {count:format.format(row.count), duration:formatDuration(row.count * windowMs)})
    main.append(estimate, elapsed)
    entry.className = "adaptive-archive-entry"
    entry.setAttribute("dir", "auto")
    entry.append(date, main, coverage)
    if (validId(row.id) && canSync(owner())) {
      const button = document.createElement("button")
      button.type = "button"
      button.textContent = "Delete Adaptive summary"
      button.addEventListener("click", () => {
        if (confirm("Delete this summary from this browser and your account?")) remove(row)
      })
      entry.append(button)
    }
    return entry
  }
  let renderedOwner
  const localOnlyStatus = document.createElement("p")
  const options = document.createElement("div"), choice = document.createElement("input"), label = document.createElement("label"), syncStatus = document.createElement("p"), loadOlder = document.createElement("button")
  options.hidden = true
  choice.type = "checkbox"
  const labelText = document.createElement("span")
  label.append(choice,labelText)
  const explanation = document.createElement("small")
  loadOlder.type = "button"
  loadOlder.addEventListener("click", () => flush(true))
  syncStatus.setAttribute("role","status")
  options.append(label,explanation,syncStatus,localOnlyStatus,loadOlder)
  ui.adaptiveArchiveStatus.after(options)
  choice.addEventListener("change", () => {
    const id = owner()
    if (!canSync(id)) return
    try {
      if (choice.checked) localStorage.setItem(consentKey(id),"true")
      else {
        localStorage.removeItem(consentKey(id))
        // Best effort: an already-accepted request can still exist in cloud and can be deleted.
        active.abort()
        active = new AbortController()
        work = null
        for (const entry of outbox(id)) if (entry.op.type === "save") localStorage.removeItem(entry.name)
      }
      if (work) paused = true
      else flush()
    } catch { syncFailure=true }
    render()
  })
  function render() {
    const id = owner(), ready = resolved()
    if (renderedOwner !== id || !ready) ui.adaptiveArchive.open = false
    if (renderedOwner !== id || !active) {
      active?.abort()
      active = new AbortController()
      remote = []; hasFreshRemote = false; cursor = null; hasMore = false; syncFailure = false; paused = false; work = null
    }
    renderedOwner = id
    let unavailable = !ready, data = []
    if (ready) {
      try {
        data = read(id)
        if (canSync(id)) {
          const deletes = new Set(outbox(id).filter(entry=>entry.op.type === "remove").map(entry=>entry.recordId))
          if (hasFreshRemote) {
            const acknowledged = new Set(JSON.parse(localStorage.getItem(remoteKey(id)) || "[]"))
            const found = new Set(remote.map(row=>row.id))
            const afterCursor = row => cursor && (row.completedAt > cursor.p_before_ms ||
              (row.completedAt === cursor.p_before_ms && row.id >= cursor.p_before_id))
            data = data.filter(row=>!acknowledged.has(row.id) || found.has(row.id) || (hasMore && !afterCursor(row)))
          }
          const known = new Set(data.map(row=>row.id))
          data = [...data,...remote.filter(row=>!known.has(row.id))].filter(row=>!deletes.has(row.id))
          data.sort((a,b)=>b.completedAt-a.completedAt)

        }
      } catch { unavailable = true }
    }
    ui.adaptiveArchiveList.replaceChildren(...data.map(renderRow))
    ui.adaptiveArchiveEmpty.hidden = unavailable || data.length > 0
    ui.adaptiveArchiveStatus.hidden = !unavailable
    options.hidden = !canSync(id)
    let pending = false, localOnly = false
    try {
      choice.checked = permitted(id)
      if (canSync(id)) {
        const queued = outbox(id)
        pending = queued.length > 0
        const tracked = new Set([...queued.map(entry=>entry.recordId),...JSON.parse(localStorage.getItem(remoteKey(id)) || "[]"),...remote.map(row=>row.id)])
        localOnly = read(id).some(row=>validId(row.id) && !tracked.has(row.id))
      }
    } catch { syncFailure = Boolean(canSync(id)) }
    const hindi = document.documentElement.lang === "hi"
    labelText.textContent = hindi ? " नए Adaptive सारांश इस खाते में सिंक करें" : " Sync new Adaptive summaries to this account"
    explanation.textContent = hindi
      ? " खाते में अनुमान, तारीख, अवधि, मोड और विंडो की संख्या जाती हैं। पुराने सत्र और मूल सिग्नल अपलोड नहीं होते। बंद करने पर नए और अभी न भेजे गए सारांश इसी ब्राउज़र में रहेंगे।"
      : " Syncs the estimate, timestamp, duration, mode and window count, not raw signals or older sessions. Turn it off to keep new and unsent summaries in this browser. Previously synced summaries remain in your account until deleted."
    syncStatus.textContent = syncFailure
      ? (hindi ? " सिंक उपलब्ध नहीं है। स्थानीय सारांश सुरक्षित हैं।" : (pending ? " Sync unavailable. Local summaries remain; pending changes retry online." : " Sync unavailable. Local summaries remain."))
      : pending ? (hindi ? " सिंक बाकी है।" : " Sync pending.") : choice.checked
        ? (hindi ? " नए सारांशों का सिंक चालू है।" : " Sync on for new summaries.")
        : (hindi ? " नए सारांशों का सिंक रुका है।" : " Sync paused for new summaries.")
    localOnlyStatus.hidden = !localOnly
    localOnlyStatus.textContent = localOnly
      ? (hindi ? " कुछ सारांश सिर्फ़ इस ब्राउज़र में हैं और अपने आप सिंक नहीं होंगे।" : " Some summaries are only in this browser and will not sync automatically.") : ""
    loadOlder.textContent = hindi ? " पुराने खाते के सारांश दिखाएँ" : "Load older account summaries"
    loadOlder.hidden = !canSync(id) || !hasMore
    loadOlder.disabled = Boolean(work)
  }
  const session = () => { render(); flush() }
  document.addEventListener("neurofront:accountreset", session)
  document.addEventListener("neurofront:sessionresolved", session)
  document.addEventListener("neurofront:languagechange", render)
  window.addEventListener("online", () => flush())
  window.addEventListener("focus", () => flush())
  window.addEventListener("storage", event => {
    if (!event.key || event.key === key(owner()) || (owner() && event.key.startsWith(accountPrefix(owner())))) render()
  })
  window.NeuroFrontAdaptiveHistory = Object.freeze({ save, formatDuration })
  session()
})()
