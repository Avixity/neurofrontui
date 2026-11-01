"use strict"

const crypto = require("node:crypto")
const scores = require("./score-config.js")
const FEATURES = ["mean", "rms", "stdDev", "peakToPeak", "derivativeMean"]
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ID = /^[a-zA-Z0-9._:-]{1,100}$/

class AccountError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status }
}
function config(env = process.env) {
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || ""
  try {
    const url = new URL(env.SUPABASE_URL)
    if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null
    // A secret/service-role key must never be published by the configuration endpoint.
    const legacy = key.split(".")
    const role = legacy.length === 3 ? JSON.parse(Buffer.from(legacy[1], "base64url").toString()).role : null
    if (!(key.startsWith("sb_publishable_") || role === "anon") || key.length > 3000) return null
    return { url: url.origin, publishableKey: key }
  } catch { return null }
}
function configHandler(request, response) {
  response.setHeader("Content-Type", "application/json; charset=utf-8")
  response.setHeader("Cache-Control", "no-store")
  response.setHeader("X-Content-Type-Options", "nosniff")
  if (request.method !== "GET") { response.setHeader("Allow", "GET"); response.statusCode = 405; response.end(JSON.stringify({ error: "method_not_allowed" })); return }
  const values = config()
  response.statusCode = 200
  response.end(JSON.stringify(values ? { configured: true, ...values } : { configured: false }))
}
async function jsonRequest(fetcher, url, headers, signal, maxBytes = 2000000) {
  let response
  try { response = await fetcher(url, { headers, signal, redirect: "error" }) } catch { throw new AccountError("unavailable", 503) }
  if (!response.ok) throw new AccountError(response.status === 401 || response.status === 403 ? "unauthorized" : "unavailable", response.status === 401 || response.status === 403 ? 401 : 503)
  if (Number(response.headers?.get("content-length") || 0) > maxBytes) throw new AccountError("unavailable", 503)
  let text
  if (response.body?.getReader) {
    const reader = response.body.getReader()
    const chunks = []
    let bytes = 0
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        bytes += next.value.byteLength
        if (bytes > maxBytes) { await reader.cancel(); throw new AccountError("unavailable", 503) }
        chunks.push(Buffer.from(next.value))
      }
      text = Buffer.concat(chunks).toString("utf8")
    } finally { reader.releaseLock() }
  } else {
    text = await response.text()
    if (Buffer.byteLength(text) > maxBytes) throw new AccountError("unavailable", 503)
  }
  try { return JSON.parse(text) } catch { throw new AccountError("unavailable", 503) }
}
async function verifyUser(authorization, env, fetcher, signal) {
  const settings = config(env)
  if (!settings) throw new AccountError("not_configured", 503)
  if (typeof authorization !== "string" || !/^Bearer [A-Za-z0-9_.-]{20,8192}$/.test(authorization)) throw new AccountError("unauthorized", 401)
  const headers = { apikey: settings.publishableKey, Authorization: authorization }
  const user = await jsonRequest(fetcher, `${settings.url}/auth/v1/user`, headers, signal, 32768)
  if (!user || !UUID.test(user.id)) throw new AccountError("unauthorized", 401)
  return { id: user.id, settings, headers }
}
function captureSummary(capture) {
  if (!capture || !ID.test(capture.id) || !capture.baseline || !Array.isArray(capture.samples)) throw new AccountError("invalid_capture", 422)
  const baseline = capture.baseline
  const canonical = JSON.stringify([baseline.createdAt, baseline.calculationVersion, baseline.unit, baseline.sampleIntervalMs, baseline.durationMs, FEATURES.map(key => baseline[key]), baseline.samples])
  return {
    id: capture.id, completedAt: capture.completedAt, durationMs: capture.durationMs,
    score: capture.stress?.score, categoryId: scores.classify(capture.stress?.score).id,
    calculationVersion: capture.calculationVersion, unit: capture.unit, sampleCount: capture.samples.length,
    summary: { average: capture.summary?.average, peak: capture.summary?.peak, minimum: capture.summary?.minimum, activityLabel: capture.summary?.activityLabel },
    baseline: { createdAt: baseline.createdAt, calculationVersion: baseline.calculationVersion, unit: baseline.unit,
      sampleIntervalMs: baseline.sampleIntervalMs, durationMs: baseline.durationMs,
      features: Object.fromEntries(FEATURES.map(key => [key, baseline[key]])), fingerprint: crypto.createHash("sha256").update(canonical).digest("hex") }
  }
}
async function accountContext(user, captureId, fetcher, signal) {
  if (!ID.test(captureId)) throw new AccountError("invalid_request", 400)
  // The owner comes exclusively from Auth. RLS independently enforces the JWT owner.
  const endpoint = `${user.settings.url}/rest/v1/nf_captures`
  const query = new URLSearchParams({ select: "owner_id,id,payload", owner_id: `eq.${user.id}`, id: `eq.${captureId}`, limit: "1" })
  const rows = await jsonRequest(fetcher, `${endpoint}?${query}`, user.headers, signal)
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0].owner_id !== user.id || rows[0].id !== captureId) throw new AccountError("capture_not_found", 404)
  const selected = captureSummary(rows[0].payload)
  const previousQuery = new URLSearchParams({ select: "owner_id,id,payload", owner_id: `eq.${user.id}`, "payload->>completedAt": `lt.${selected.completedAt}`, order: "payload->>completedAt.desc,id.desc", limit: "120" })
  let previous = [], historyAvailable = true
  try {
    const records = await jsonRequest(fetcher, `${endpoint}?${previousQuery}`, user.headers, signal, 20000000)
    if (!Array.isArray(records) || records.some(record => record.owner_id !== user.id)) throw new Error("Invalid owner")
    previous = records.filter(record => record.id !== selected.id).map(record => captureSummary(record.payload))
  } catch { historyAvailable = false }
  const compatible = previous.filter(record => scores.compatible(selected, record))
  const incompatible = previous.filter(record => !scores.compatible(selected, record))
  return { selected, previous: [...compatible, ...incompatible].slice(0, 12), historyAvailable }
}

module.exports = { config, configHandler, verifyUser, accountContext, captureSummary, AccountError }
