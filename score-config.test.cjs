"use strict"

// Synthetic capture summaries test shared classification and comparison arithmetic.
const test = require("node:test")
const assert = require("node:assert/strict")
const fs = require("node:fs")
const vm = require("node:vm")
const scores = require("./score-config.js")

function capture(id, score, day, overrides = {}) {
  return {
    id, score, completedAt: new Date(Date.UTC(2026, 9, day)).toISOString(),
    calculationVersion: "neurofront-legacy-1", unit: "uV", durationMs: 15000,
    baseline: {
      fingerprint: "a".repeat(64), calculationVersion: "neurofront-legacy-1", unit: "uV",
      sampleIntervalMs: 50, durationMs: 20000
    },
    ...overrides
  }
}

test("the shared meter categories preserve every exact boundary", () => {
  const cases = [
    [0, "relaxed"], [34.999999, "relaxed"], [35, "balanced"], [59.999999, "balanced"],
    [60, "elevated"], [77.999999, "elevated"], [78, "high"], [100, "high"]
  ]
  for (const [value, expected] of cases) assert.equal(scores.classify(value).id, expected, `${value}`)
  for (const value of [NaN, Infinity, -Infinity, -0.01, 100.01, null, undefined, "80"])
    assert.throws(() => scores.classify(value), RangeError)
  assert.ok(Object.isFrozen(scores.categories))
  for (const category of scores.categories) assert.ok(Object.isFrozen(category))
})

test("baseline identity and all acquisition/calculation settings must match", () => {
  const current = capture("current", 80, 31)
  assert.equal(scores.compatible(current, capture("old", 50, 20)), true)
  const variants = [
    { calculationVersion: "neurofront-next" }, { unit: "mV" }, { durationMs: 16000 },
    ...[
      ["fingerprint", "b".repeat(64)], ["fingerprint", ""], ["calculationVersion", "other"],
      ["unit", "mV"], ["sampleIntervalMs", 100], ["durationMs", 21000]
    ].map(([key, value]) => ({ baseline: { ...current.baseline, [key]: value } }))
  ]
  for (const changes of variants) assert.equal(scores.compatible(current, capture("old", 50, 20, changes)), false)
  assert.equal(scores.compatible(current, capture("old", 50, 20, { baseline: null })), false)
})

test("comparison excludes the selected capture, newer timestamps, duplicates and invalid scores", () => {
  const selected = capture("selected", 80, 31)
  const earlier = capture("earlier", 50, 20)
  const previous = [
    selected, { ...selected, completedAt: capture("ignored", 0, 1).completedAt },
    capture("same-time", 100, 31), capture("future", 100, 32),
    earlier, structuredClone(earlier), capture("older", 70, 10),
    capture("invalid", NaN, 19), { ...capture("bad-date", 50, 3), completedAt: "not a date" }
  ]
  const result = scores.compareCaptures(selected, previous)
  assert.equal(result.status, "available")
  assert.equal(result.count, 2)
  assert.equal(result.average, 60)
  assert.equal(result.difference, 20)
  assert.equal(result.from, capture("older", 70, 10).completedAt)
  assert.equal(result.to, earlier.completedAt)
  assert.equal(result.trend, null)
})

test("missing history and incompatible baselines cannot become a fabricated comparison", () => {
  const selected = capture("selected", 80, 31)
  const incompatible = capture("old", 50, 20, { baseline: { ...selected.baseline, fingerprint: "b".repeat(64) } })
  const absent = scores.compareCaptures(selected, [])
  assert.equal(absent.status, "none")
  const unavailable = scores.compareCaptures(selected, [capture("old", 50, 20)], false)
  assert.equal(unavailable.status, "unavailable")
  const excluded = scores.compareCaptures(selected, [incompatible])
  assert.equal(excluded.status, "incompatible")
  assert.equal(excluded.excludedCount, 1)
  for (const result of [absent, unavailable, excluded]) {
    assert.equal(result.count, 0)
    for (const field of ["average", "difference", "from", "to", "trend"]) assert.equal(result[field], null)
  }
})

test("mixed baselines are excluded while the most recent twelve comparable records are retained", () => {
  const selected = capture("selected", 80, 31)
  const previous = Array.from({ length: 15 }, (_, index) => capture(`prior-${index + 1}`, index + 1, index + 1))
  const incompatible = capture("different-baseline", 100, 25, { baseline: { ...selected.baseline, fingerprint: "b".repeat(64) } })
  previous.splice(3, 0, incompatible)
  const result = scores.compareCaptures(selected, previous)
  assert.equal(result.count, 12)
  assert.equal(result.excludedCount, 1)
  assert.equal(result.average, 9.5)
  assert.equal(result.difference, 70.5)
  assert.equal(result.from, capture("oldest-used", 4, 4).completedAt)
  assert.equal(result.to, capture("newest-used", 15, 15).completedAt)
  assert.equal(result.trend, "increasing")
})

test("trends use chronological order and only the three most recent comparable captures", () => {
  const selected = capture("selected", 80, 31)
  const cases = [
    [[30, 40, 50], "increasing"], [[50, 40, 30], "decreasing"],
    [[30, 50, 40], "mixed"], [[40, 40, 40], "mixed"], [[30, 40], null]
  ]
  for (const [values, expected] of cases) {
    const previous = values.map((score, index) => capture(`prior-${index}`, score, 20 + index)).reverse()
    if (values.length === 3) previous.push(capture("outlier-older", 100, 1))
    assert.equal(scores.compareCaptures(selected, previous).trend, expected)
  }
})

test("difference keeps its direction and comparison never mutates saved records", () => {
  const selected = capture("selected", 40, 31)
  const previous = [capture("one", 50, 20), capture("two", 70, 21)]
  const before = structuredClone({ selected, previous })
  const result = scores.compareCaptures(selected, previous)
  assert.equal(result.average, 60)
  assert.equal(result.difference, -20)
  assert.deepEqual({ selected, previous }, before)
  assert.equal(scores.compareCaptures({ ...selected, score: 60 }, previous).difference, 0)
})

test("all thirteen offline dictionaries explain each category with matching translated names and placeholders", () => {
  const sandbox = { window: {} }
  vm.createContext(sandbox)
  for (const file of ["language-data.js", "assistant-language.js"])
    vm.runInContext(fs.readFileSync(`${__dirname}/${file}`, "utf8"), sandbox)
  const dictionaries = sandbox.window.NEUROFRONT_TRANSLATIONS
  assert.equal(Object.keys(dictionaries).length, 13)
  const englishKeys = Object.keys(dictionaries.en).filter(key => key.startsWith("assistant."))
  const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort()
  for (const [language, dictionary] of Object.entries(dictionaries)) {
    for (const key of englishKeys) {
      assert.equal(typeof dictionary[key], "string", `${language}:${key}`)
      assert.deepEqual(placeholders(dictionary[key]), placeholders(dictionaries.en[key]), `${language}:${key}`)
      assert.equal(dictionary[key].includes("\u2014"), false, `${language}:${key}`)
    }
    for (const { id } of scores.categories) {
      const text = dictionary[`assistant.preset.${id}`]
      assert.ok(text.includes(dictionary[`stress.${id}`]), `${language}:${id}`)
      assert.ok(text.includes("{score}/100"), `${language}:${id}`)
    }
    assert.ok(dictionary["assistant.reference"].includes("{date}"), language)
  }
})
