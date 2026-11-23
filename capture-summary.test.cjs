const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const vm = require('node:vm')
const { test } = require('node:test')

test('monthly stress summary counts only saved captures in the active account and local month', () => {
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.listeners = {}; this.open = false }
    replaceChildren(...children) { this.children = children }
    append(...children) { this.children.push(...children) }
    setAttribute() {}
    addEventListener(type, listener) { this.listeners[type] = listener }
    focus() {}
    showModal() { this.open = true }
    close() { if (this.open) { this.open = false; this.listeners.close?.() } }
  }
  const elements = new Map()
  const document = new Element()
  document.documentElement = { lang: 'en' }
  document.createElement = () => new Element()
  document.createElementNS = () => new Element()
  document.getElementById = id => {
    if (!elements.has(id)) elements.set(id, new Element())
    return elements.get(id)
  }
  const monthStart = new Date(2026, 10, 1)
  const date = (day, hour = 12) => new Date(monthStart.getFullYear(), monthStart.getMonth(), day, hour).toISOString()
  class TestDate extends Date { constructor(...args) { super(...(args.length ? args : [date(15)])) } }
  const capture = (id, completedAt, score, cloudSaved = true) => ({
    id, completedAt, startedAt: completedAt, cloudSaved, schemaVersion: 1, durationMs: 1000, sampleIntervalMs: 50, unit: 'uV', samples: [1, 2],
    axisMin: 0, axisMax: 3, stress: { score, label: 'Balanced' }, summary: { average: 1, peak: 2, minimum: 1, activityLabel: 'Stable' },
    baseline: { mean: 1, rms: 1, stdDev: 1, peakToPeak: 1, derivativeMean: 1, samples: [1], durationMs: 1000, sampleIntervalMs: 50 }
  })
  let account = { user: { id: 'account-a' }, captures: [
    capture('one', date(2), 10), capture('two', date(2, 13), 40), capture('three', date(3), 70),
    capture('pending', date(4), 100, false), capture('different-month', date(0), 100)
  ] }
  const window = { NeuroFrontAccount: { getState: () => account }, NEUROFRONT_TRANSLATIONS: Object.fromEntries('en hi mr bn ta te kn ml gu pa or as ur'.split(' ').map(locale => [locale, {}])) }
  const context = vm.createContext({ window, document, Date: TestDate })
  vm.runInContext(readFileSync(__dirname + '/capture-language.js', 'utf8'), context)
  vm.runInContext(readFileSync(__dirname + '/capture-history.js', 'utf8'), context)
  const field = id => document.getElementById(id)
  document.listeners['neurofront:accountreset']({ detail: { nextOwner: 'account-a' } })
  document.listeners['neurofront:accountrecords']({ detail: { owner: 'account-a' } })
  assert.match(field('stressSummaryStatus').textContent, /November 2026: 40\/100 average across 3 saved captures/)
  assert.match(field('stressSummaryTrend').textContent, /25\/100.*70\/100/)
  assert.deepEqual(field('stressSummaryDays').children.map(row => row.children[1].value), [25, 70])
  assert.equal(field('historyList').children.length, 2)
  field('historyOpen').listeners.click()
  assert.equal(field('historyGroups').children.length, 4)
  assert.equal(field('historyGroups').children[0].children[1].children[0].children[1].children[0].dataset.captureId, 'pending')

  document.listeners['neurofront:accountreset']({ detail: { nextOwner: 'account-b' } })
  document.listeners['neurofront:accountrecords']({ detail: { owner: 'account-a' } })
  assert.equal(field('historyDialog').open, false)
  assert.equal(field('historyList').children.length, 0)
  assert.equal(field('stressSummaryDays').children.length, 0)
  account = { user: { id: 'account-b' }, captures: [capture('four', date(5), 55)] }
  document.listeners['neurofront:accountrecords']({ detail: { owner: 'account-b' } })
  assert.match(field('stressSummaryStatus').textContent, /55\/100 average from 1 saved capture/)
})
