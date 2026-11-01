(function (root, factory) {
  const api = factory()
  if (typeof module === "object" && module.exports) module.exports = api
  else root.NeuroFrontScore = api
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict"
  const categories = Object.freeze([
    Object.freeze({ id: "relaxed", upper: 35, label: "Relaxed", feedback: "You look relaxed relative to your session baseline." }),
    Object.freeze({ id: "balanced", upper: 60, label: "Balanced", feedback: "You appear close to your personal baseline." }),
    Object.freeze({ id: "elevated", upper: 78, label: "Elevated", feedback: "Stress appears mildly elevated. Consider a brief pause." }),
    Object.freeze({ id: "high", upper: Infinity, label: "High", feedback: "Stress appears high. Slow down and take a short break." })
  ])
  function classify(score) {
    if (!Number.isFinite(score) || score < 0 || score > 100) throw new RangeError("Invalid score")
    return categories.find(category => score < category.upper)
  }
  function compatible(a, b) {
    return Boolean(a.baseline?.fingerprint && a.baseline.fingerprint === b.baseline?.fingerprint &&
      a.calculationVersion === b.calculationVersion && a.unit === b.unit && a.durationMs === b.durationMs &&
      a.baseline.calculationVersion === b.baseline.calculationVersion && a.baseline.unit === b.baseline.unit &&
      a.baseline.sampleIntervalMs === b.baseline.sampleIntervalMs && a.baseline.durationMs === b.baseline.durationMs)
  }
  function compareCaptures(selected, previous, historyAvailable = true) {
    const empty = { status: "unavailable", count: 0, excludedCount: 0, from: null, to: null, average: null, difference: null, trend: null }
    if (!historyAvailable) return empty
    const unique = new Map()
    for (const capture of previous || []) {
      if (capture.id !== selected.id && Date.parse(capture.completedAt) < Date.parse(selected.completedAt) && Number.isFinite(capture.score)) unique.set(capture.id, capture)
    }
    const earlier = [...unique.values()].sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt))
    const comparable = earlier.filter(capture => compatible(selected, capture)).slice(0, 12)
    const excludedCount = earlier.filter(capture => !compatible(selected, capture)).length
    if (!comparable.length) return { ...empty, status: earlier.length ? "incompatible" : "none", excludedCount }
    const average = comparable.reduce((sum, capture) => sum + capture.score, 0) / comparable.length
    const recent = comparable.slice(0, 3).reverse().map(capture => capture.score)
    const trend = recent.length < 3 ? null : recent[0] < recent[1] && recent[1] < recent[2] ? "increasing" : recent[0] > recent[1] && recent[1] > recent[2] ? "decreasing" : "mixed"
    return { status: "available", count: comparable.length, excludedCount, from: comparable.at(-1).completedAt, to: comparable[0].completedAt, average, difference: selected.score - average, trend }
  }
  return Object.freeze({ categories, classify, compatible, compareCaptures })
})
