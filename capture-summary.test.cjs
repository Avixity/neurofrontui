const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')

test('monthly stress summary counts only saved captures in the active account and local month', () => {
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.listeners = {}; this.open = false }
    replaceChildren(...children) { this.children = children }
    append(...children) { this.children.push(...children) }
    setAttribute(name, value) { this[name] = value }
    querySelectorAll(tag) { return this.children.flatMap(child => [...(child.tag === tag ? [child] : []), ...child.querySelectorAll(tag)]) }
    addEventListener(type, listener) { this.listeners[type] = listener }
    focus() {}
    showModal() { this.open = true }
    close() { if (this.open) { this.open = false; this.listeners.close?.() } }
  }
  const elements = new Map()
  const document = new Element()
  document.documentElement = { lang: 'en' }
  document.createElement = tag => Object.assign(new Element(), { tag })
  document.createElementNS = () => new Element()
  document.getElementById = id => {
    if (!elements.has(id)) elements.set(id, new Element())
    return elements.get(id)
  }
  const monthStart = new Date(2026, 10, 1)
  const date = (day, hour = 12) => new Date(monthStart.getFullYear(), monthStart.getMonth(), day, hour).toISOString()
  class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [date(15, 22)])) } }
  const capture = (id, completedAt, score, cloudSaved = true) => ({
    id, completedAt, startedAt: completedAt, cloudSaved, schemaVersion: 1, durationMs: 1000, sampleIntervalMs: 50, unit: 'uV', samples: [1, 2],
    axisMin: 0, axisMax: 3, stress: { score, label: 'Balanced' }, summary: { average: 1, peak: 2, minimum: 1, activityLabel: 'Stable' },
    baseline: { mean: 1, rms: 1, stdDev: 1, peakToPeak: 1, derivativeMean: 1, samples: [1], durationMs: 1000, sampleIntervalMs: 50 }
  })
  let account = { user: { id: 'account-a' }, captures: [
    capture('one', date(2), 10), capture('two', date(2, 13), 40), capture('three', date(3), 70),
    capture('pending', date(4), 100, false), capture('different-month', date(0), 100), capture('zero', date(5, 2), 0)
  ] }
  const window = { NeuroFrontAccount: { getState: () => account }, NEUROFRONT_TRANSLATIONS: Object.fromEntries('en hi mr bn ta te kn ml gu pa or as ur'.split(' ').map(locale => [locale, {}])) }
  const context = vm.createContext({ window, document, Date: TestDate })
  vm.runInContext(readFileSync(__dirname + '/capture-language.js', 'utf8'), context)
  vm.runInContext(readFileSync(__dirname + '/capture-history.js', 'utf8'), context)
  const field = id => document.getElementById(id)
  document.listeners['neurofront:accountreset']({ detail: { nextOwner: 'account-a' } })
  document.listeners['neurofront:accountrecords']({ detail: { owner: 'account-a' } })
  assert.equal(field('historyList').children.length, 2)
  field('stressSummaryOpen').listeners.click()
  assert.equal(field('stressSummaryDialog').open, true)
  assert.equal(field('stressSummaryMonth').textContent, 'November 2026')
  assert.match(field('stressSummaryStatus').textContent, /30\/100 average across 4 saved captures/)
  assert.match(field('stressSummaryTodayNarrative').textContent, /No Standard captures/)
  const base = account.captures.slice()
  const addToday = (...items) => {
    account.captures = [...base, ...items]
    document.listeners['neurofront:accountrecords']({ detail: { owner: 'account-a' } })
    return field('stressSummaryTodayNarrative').textContent
  }
  assert.match(addToday(capture('morning1', date(15, 8), 80)), /only cover the morning/)
  assert.match(addToday(capture('morning1', date(15, 8), 80), capture('afternoon1', date(15, 14), 15)), /highest saved reading was taken during the morning.*aren't enough/)
  assert.match(addToday(capture('morning1', date(15, 8), 80), capture('morning2', date(15, 9), 60), capture('afternoon1', date(15, 14), 15), capture('afternoon2', date(15, 15), 35)), /averaged higher during the morning/)
  assert.doesNotMatch(field('stressSummaryTodayNarrative').textContent, /[\d:]|exercise/)
  assert.match(addToday(capture('morning1', date(15, 8), 60), capture('morning2', date(15, 9), 40), capture('afternoon1', date(15, 14), 70), capture('afternoon2', date(15, 15), 30)), /No single part/)
  addToday()
  const day = number => field('stressSummaryDays').querySelectorAll('button').find(button => Number(button.dataset.summaryDay) === number)
  assert.equal(field('stressSummaryWeekdays').children.length, 7)
  assert.equal(field('stressSummaryDays').querySelectorAll('button').length, 30)
  assert.equal(day(5).dataset.level, '1')
  assert.equal(day(4).dataset.level, 'empty')
  assert.match(day(5)['aria-label'], /0\/100 average/)
  day(2).listeners.click()
  assert.match(field('stressSummaryDayDetails').textContent, /25\/100 average.*Highest recorded score: 40\/100/)
  assert.match(field('stressSummaryTimes').children[3].children[1].textContent, /0\/100 average · 1 capture/)
  field('stressSummaryPrevious').listeners.click()
  assert.equal(field('stressSummaryMonth').textContent, 'October 2026')
  assert.equal(field('stressSummaryToday').hidden, true)
  assert.match(field('stressSummaryStatus').textContent, /100\/100 average from 1 saved capture/)
  field('stressSummaryNext').listeners.click()
  assert.equal(field('stressSummaryMonth').textContent, 'November 2026')
  assert.equal(field('stressSummaryNext').disabled, true)

  document.listeners['neurofront:accountreset']({ detail: { nextOwner: 'account-b' } })
  document.listeners['neurofront:accountrecords']({ detail: { owner: 'account-a' } })
  assert.equal(field('stressSummaryDialog').open, false)
  assert.equal(field('historyList').children.length, 0)
  assert.equal(field('stressSummaryDays').children.length, 0)
  account = { user: { id: 'account-b' }, captures: [capture('four', date(5), 55)] }
  document.listeners['neurofront:accountrecords']({ detail: { owner: 'account-b' } })
  field('stressSummaryOpen').listeners.click()
  assert.match(field('stressSummaryStatus').textContent, /55\/100 average from 1 saved capture/)
})
