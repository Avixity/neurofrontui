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
  const compact = ({type, completedAt, durationMs, presetMs, end, count, score, custom}) => ({type, completedAt, durationMs, presetMs, end, count, score, ...(custom === true ? {custom} : {})})
  function read(id) {
    const raw = localStorage.getItem(key(id))
    if (!raw) return []
    if (raw.length > 24000) throw new Error("Adaptive history exceeds its storage limit")
    const rows = JSON.parse(raw)
    if (!Array.isArray(rows)) throw new Error("Invalid Adaptive history")
    return rows.slice(0, maxRecords).filter(valid).map(compact)
  }
  function save(value, id) {
    if (!resolved() || owner() !== id || !valid(value)) return false
    try {
      const prior = read(id)
      const next = [compact(value), ...prior].slice(0, maxRecords)
      localStorage.setItem(key(id), JSON.stringify(next))
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
    return entry
  }
  let renderedOwner
  function render() {
    const id = owner(), ready = resolved()
    if (renderedOwner !== id || !ready) ui.adaptiveArchive.open = false
    renderedOwner = id
    let unavailable = !ready, data = []
    if (ready) {
      try { data = read(id) } catch { unavailable = true }
    }
    ui.adaptiveArchiveList.replaceChildren(...data.map(renderRow))
    ui.adaptiveArchiveEmpty.hidden = unavailable || data.length > 0
    ui.adaptiveArchiveStatus.hidden = !unavailable
  }
  document.addEventListener("neurofront:accountreset", render)
  document.addEventListener("neurofront:sessionresolved", render)
  document.addEventListener("neurofront:languagechange", render)
  window.addEventListener("storage", event => { if (!event.key || event.key === key(owner())) render() })
  window.NeuroFrontAdaptiveHistory = Object.freeze({ save, formatDuration })
  render()
})()
