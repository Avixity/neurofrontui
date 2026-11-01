"use strict"
const assert = require("node:assert/strict")
const fs = require("node:fs")
const http = require("node:http")
const path = require("node:path")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")

const baseline = { schemaVersion: 1, calculationVersion: "neurofront-stress-v1", deviceName: "NeuroFront", serviceUuid: "12345678-1234-1234-1234-1234567890ab", characteristicUuid: "abcd1234-5678-1234-5678-abcdef123456", unit: "mV", sampleIntervalMs: 50, calibrationDurationMs: 20000, createdAt: "2026-10-31T10:00:00.000Z", samples: [1, 2, 1], features: { mean: 1, rms: 1.2, stdDev: 0.3, peakToPeak: 1, derivativeMean: 0.2 } }
const capture = { id: "capture-stable-1", startedAt: "2026-10-31T10:01:00.000Z", completedAt: "2026-10-31T10:01:15.000Z", durationMs: 15000, samples: [1, 3, 2], unit: "mV", calculationVersion: baseline.calculationVersion, device: { name: baseline.deviceName, serviceUuid: baseline.serviceUuid, characteristicUuid: baseline.characteristicUuid }, baseline: { ...baseline.features, samples: baseline.samples, createdAt: baseline.createdAt, durationMs: 20000, unit: "mV", sampleIntervalMs: 50, calculationVersion: baseline.calculationVersion }, stress: { score: 60, label: "Elevated" }, summary: { average: 2, peak: 3, minimum: 1, activityLabel: "Stable" } }
const thread = { id: "00000000-0000-4000-8000-000000000001", title: "Explain this capture", capture_id: capture.id, messages: [{ id: "00000000-0000-4000-8000-000000000002", role: "assistant", status: "completed", content: "Saved synthetic explanation.", captureId: capture.id }] }
const sdk = `window.supabase={createClient(){let session=JSON.parse(localStorage.getItem("simulated-auth")||"null"), listener=()=>{}; const emit=type=>listener(type,session); window.simulatedSwitch=id=>{session=id?{user:{id,email:id+"@example.test",user_metadata:{}},access_token:"token-"+id}:null;localStorage.setItem("simulated-auth",JSON.stringify(session));emit(id?"SIGNED_IN":"SIGNED_OUT")};return {auth:{onAuthStateChange(fn){listener=fn},async getSession(){return {data:{session},error:null}},async signInWithPassword({email}){simulatedSwitch(email.split("@")[0]);return {data:{session},error:null}},async signUp({email}){return {data:{session:null},error:null}},async signOut(){simulatedSwitch(null);return {error:null}},async resetPasswordForEmail(){return {error:null}},async updateUser(){return {error:null}}}}}}`

;(async () => {
  const database = new Map(["a", "b"].map(id => [id, { profile: { id, revision: 1, display_name: id.toUpperCase(), avatar_path: null, preferences: { language: id === "a" ? "hi" : "en", resourcesExpanded: false }, active_baseline_id: null }, baselines: [], captures: [], threads: [], messages: [], capture_deletions: [] }]))
  const calls = []
  let offline = false
  let heldCaptureSaveId = null, releaseCaptureSave = null
  const server = http.createServer((_request, response) => response.writeHead(200, { "Content-Type": "text/html" }).end('<!doctype html><html lang="en"><body></body></html>'))
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve))
  const url = `http://127.0.0.1:${server.address().port}`
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined })
  const context = await browser.newContext()
  const errors = []
  const configRoute = route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ configured: true, url: "https://synthetic.supabase.co", publishableKey: "synthetic-public-key" }) })
  const sdkRoute = route => route.fulfill({ contentType: "application/javascript", body: sdk })
  const backendRoute = async route => {
    const request = route.request(), url = new URL(request.url())
    const id = request.headers().authorization?.replace("Bearer token-", "")
    const db = database.get(id)
    const body = request.method() === "POST" ? request.postDataJSON() : null
    calls.push({ id, path: url.pathname, body })
    const respond = (status, value) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) })
    if (!db) return respond(401, { code: "auth" })
    if (offline) return respond(503, { code: "offline" })
    if (url.pathname.includes("/rpc/")) {
      const name = url.pathname.split("/").at(-1)
      if (name === "nf_save_profile") {
        if (body.p_expected_revision !== db.profile.revision) return respond(409, { code: "40001" })
        db.profile = { ...db.profile, display_name: body.p_display_name, avatar_path: body.p_avatar_path, preferences: body.p_preferences, active_baseline_id: body.p_active_baseline_id, revision: db.profile.revision + 1 }
        return respond(200, structuredClone(db.profile))
      }
      if (name === "nf_save_baseline") {
        let row = db.baselines.find(row => row.id === body.p_id)
        if (!row) { row = { id: body.p_id, owner_id: id, payload: body.p_payload }; db.baselines.push(row) }
        return respond(200, row)
      }
      if (name === "nf_save_capture") {
        if (body.p_id === heldCaptureSaveId) await new Promise(resolve => { releaseCaptureSave = resolve })
        if (db.capture_deletions.some(row => row.id === body.p_id)) return respond(404, { code: "P0002" })
        if (!db.baselines.some(row => row.id === body.p_baseline_id)) return respond(400, { code: "invalid_baseline" })
        let row = db.captures.find(row => row.id === body.p_id)
        if (!row) { row = { id: body.p_id, owner_id: id, baseline_id: body.p_baseline_id, payload: body.p_payload }; db.captures.push(row) }
        return respond(200, row)
      }
      if (name === "nf_delete_capture") {
        let tombstone = db.capture_deletions.find(row => row.id === body.p_id)
        if (!tombstone) { tombstone = { owner_id: id, id: body.p_id, deleted_at: new Date().toISOString() }; db.capture_deletions.push(tombstone) }
        const affected = new Set(db.threads.filter(row => row.capture_id === body.p_id).map(row => row.id))
        for (const message of db.messages) if (message.payload.captureId === body.p_id || message.payload.capture?.id === body.p_id || message.payload.retryJob?.captureId === body.p_id) {
          affected.add(message.thread_id)
          delete message.payload.captureId; delete message.payload.capture; delete message.payload.retryJob
          message.capture_id = null
        }
        const affected_threads = []
        for (const row of db.threads) if (affected.has(row.id)) {
          if (row.capture_id === body.p_id) row.capture_id = null
          row.revision++
          affected_threads.push({ id: row.id, revision: row.revision })
        }
        db.captures = db.captures.filter(row => row.id !== body.p_id)
        return respond(200, { id: body.p_id, deleted: true, deleted_at: tombstone.deleted_at, affected_threads })
      }
      if (name === "nf_save_thread") {
        const previous = db.threads.find(row => row.id === body.p_id)
        if (body.p_expected_revision !== (previous?.revision || 0)) return respond(409, { code: "40001" })
        const row = { id: body.p_id, owner_id: id, title: body.p_title, capture_id: body.p_capture_id, revision: (previous?.revision || 0) + 1 }
        db.threads = db.threads.filter(value => value.id !== row.id).concat(row)
        db.messages = db.messages.filter(value => value.thread_id !== row.id).concat(body.p_messages.map(message => ({ ...message, owner_id: id, thread_id: row.id })))
        return respond(200, row)
      }
      return respond(400, { code: "unknown" })
    }
    if (url.searchParams.get(url.pathname.endsWith("nf_profiles") ? "id" : "owner_id") !== `eq.${id}`) return respond(403, { code: "ownership" })
    const name = url.pathname.split("/").at(-1).replace("nf_", "")
    return respond(200, name === "profiles" ? [db.profile] : db[name] || [])
  }
  async function installRoutes(target) {
    await target.route("**/api/account-config", configRoute)
    await target.route("**/supabase-2.118.0.js", sdkRoute)
    await target.route("https://synthetic.supabase.co/**", backendRoute)
  }
  await installRoutes(context)
  async function pageWithStore(target = context) {
    const page = await target.newPage()
    page.on("pageerror", error => errors.push(error.message))
    await page.goto(url)
    await page.evaluate(({ baseline, capture }) => {
      window.fixture = { baseline, capture }
      window.device = { active: false, resetCount: 0, saved: null }
      window.chatPrivate = ""
      window.NeuroFrontAssistant = { resetForAccount: () => { chatPrivate = "" } }
      window.accountResets = []
      window.NeuroFrontDevice = { busy: () => device.active, validBaseline: value => Boolean(value?.samples?.length && value?.features), setSavedBaseline: value => { device.saved = value }, resetForAccount: () => { device.resetCount++; device.active = false }, loadGuestBaseline: () => { device.saved = JSON.parse(localStorage.getItem("neurofront.baseline.v1") || "null") } }
      window.NeuroFrontI18n = { select: locale => { document.documentElement.lang = locale } }
      window.NeuroFrontResources = { setExpanded: value => { window.expanded = value } }
      window.NeuroFrontHistory = { validCapture: value => Boolean(value?.id && value?.baseline?.samples?.length), readGuestCaptures: async () => JSON.parse(localStorage.getItem("synthetic-guest-captures") || "[]") }
      document.addEventListener("neurofront:accountreset", event => { chatPrivate = ""; accountResets.push({ ...event.detail, currentOwner: NeuroFrontAccount.owner() }) })
    }, { baseline, capture })
    await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, "account-store.js"), "utf8") })
    await page.waitForFunction(() => NeuroFrontAccount.getState().configured)
    return page
  }
  let page
  try {
    page = await pageWithStore()
    await page.evaluate(() => { localStorage.setItem("neurofront.baseline.v1", JSON.stringify(fixture.baseline)); localStorage.setItem("synthetic-guest-captures", JSON.stringify([fixture.capture])) })
    await page.evaluate(() => NeuroFrontAccount.signIn("a@example.test", "synthetic-password"))
    await page.waitForFunction(() => !NeuroFrontAccount.getState().loading && NeuroFrontAccount.getState().guestAvailable)
    assert.equal(await page.evaluate(() => NeuroFrontAccount.getState().captures.length), 0)
    assert.equal(database.get("a").captures.length, 0)
    assert.equal(await page.evaluate(() => document.documentElement.lang), "hi")
    assert.equal((await page.evaluate(() => accountResets)).at(-1).currentOwner, "a")
    await page.evaluate(() => NeuroFrontAccount.importGuest())
    await page.waitForFunction(() => NeuroFrontAccount.getState().pending === 0)
    await page.evaluate(() => NeuroFrontAccount.importGuest())
    await page.waitForFunction(() => NeuroFrontAccount.getState().pending === 0)
    assert.equal(database.get("a").captures.length, 1)
    assert.equal(database.get("a").baselines.length, 1)
    assert.deepEqual(database.get("a").captures[0].payload, capture)
    assert.ok(database.get("a").profile.active_baseline_id)
    await page.evaluate(thread => Promise.all([NeuroFrontAccount.saveThread(thread, "a"), NeuroFrontAccount.saveThread({ ...thread, messages: [...thread.messages, { id: "00000000-0000-4000-8000-000000000003", role: "user", status: "completed", content: "Follow-up" }] }, "a")]), thread)
    await page.waitForFunction(() => NeuroFrontAccount.getState().pending === 0 && !NeuroFrontAccount.getState().error)
    assert.equal(database.get("a").threads.length, 1)
    assert.equal(database.get("a").messages.length, 2)
    const threadRevision = database.get("a").threads[0].revision
    assert.equal(threadRevision, 2)

    database.get("a").threads[0].revision = 3
    database.get("a").threads[0].title = "Newer remote conversation"
    database.get("a").messages.push({ id: "remote-message", thread_id: thread.id, owner_id: "a", ordinal: 2, payload: { id: "remote-message", role: "assistant", status: "completed", content: "Newer remote message" } })
    await page.evaluate(value => { chatPrivate = "stale open thread"; return NeuroFrontAccount.saveThread({ ...value, revision: 2, title: "Stale thread edit" }, "a") }, thread)
    await page.waitForFunction(() => NeuroFrontAccount.getState().conflict)
    assert.equal(database.get("a").threads[0].title, "Newer remote conversation")
    await page.evaluate(value => NeuroFrontAccount.saveThread({ ...value, revision: 2, messages: [...value.messages, { id: "00000000-0000-4000-8000-000000000004", role: "user", status: "completed", content: "Keep this local reply" }] }, "a"), thread)
    await page.evaluate(() => NeuroFrontAccount.reload())
    await page.waitForFunction(() => NeuroFrontAccount.getState().status === "saved")
    assert.equal(database.get("a").threads.length, 2)
    assert.equal(database.get("a").threads.find(row => row.id === thread.id).title, "Newer remote conversation")
    assert.ok(database.get("a").messages.some(row => row.thread_id !== thread.id && row.payload.content === "Keep this local reply"))
    assert.equal(await page.evaluate(() => chatPrivate), "")

    offline = true
    const second = { ...structuredClone(capture), id: "capture-stable-2", completedAt: "2026-10-31T10:05:15.000Z" }
    await page.evaluate(record => NeuroFrontAccount.saveCapture(record, "a"), second)
    await page.waitForFunction(() => NeuroFrontAccount.getState().error)
    assert.equal(await page.evaluate(() => NeuroFrontAccount.getState().status), "error")
    assert.equal(await page.evaluate(() => NeuroFrontAccount.captureSaved("capture-stable-2")), false)
    await page.close()
    page = await pageWithStore()
    await page.waitForFunction(() => NeuroFrontAccount.getState().error && NeuroFrontAccount.getState().pending > 0)
    assert.equal(await page.evaluate(() => NeuroFrontAccount.getState().captures.some(item => item.id === "capture-stable-2")), true)
    offline = false
    await page.evaluate(() => window.dispatchEvent(new Event("online")))
    await page.waitForFunction(() => NeuroFrontAccount.getState().status === "saved")
    assert.equal(database.get("a").captures.length, 2)
    assert.equal(await page.evaluate(() => NeuroFrontAccount.captureSaved("capture-stable-2")), true)

    database.get("a").profile.revision++
    database.get("a").profile.preferences.resourcesExpanded = true
    await page.evaluate(() => NeuroFrontAccount.updateProfile({ display_name: "Stale preference edit" }))
    await page.waitForFunction(() => NeuroFrontAccount.getState().conflict)
    assert.notEqual(database.get("a").profile.display_name, "Stale preference edit")
    assert.equal(await page.evaluate(() => NeuroFrontAccount.getState().status), "conflict")
    await page.evaluate(() => NeuroFrontAccount.reload())
    await page.waitForFunction(() => NeuroFrontAccount.getState().status === "saved")
    assert.equal(await page.evaluate(() => expanded), true)

    const otherDevice = await browser.newContext()
    await installRoutes(otherDevice)
    const otherPage = await pageWithStore(otherDevice)
    assert.equal(await otherPage.evaluate(() => NeuroFrontAccount.owner()), null)
    await otherPage.evaluate(() => NeuroFrontAccount.signIn("a@example.test", "synthetic-password"))
    await otherPage.waitForFunction(() => NeuroFrontAccount.getState().status === "saved")
    assert.equal(await otherPage.evaluate(() => NeuroFrontAccount.getState().captures.length), 2)
    assert.deepEqual(await otherPage.evaluate(() => device.saved), baseline)
    assert.equal(await otherPage.evaluate(id => NeuroFrontAccount.getState().threads.find(row => row.id === id).messages.length, thread.id), 3)
    assert.equal(await otherPage.evaluate(() => expanded), true)
    await otherDevice.close()

    await page.evaluate(() => { chatPrivate = "private A"; device.active = true })
    await assert.rejects(page.evaluate(() => NeuroFrontAccount.signOut()), /activeCapture/)
    assert.equal(await page.evaluate(() => NeuroFrontAccount.owner()), "a")
    await page.evaluate(() => { device.active = false })
    offline = true
    const third = { ...structuredClone(capture), id: "capture-stable-3" }
    await page.evaluate(record => NeuroFrontAccount.saveCapture(record, "a"), third)
    await page.waitForFunction(() => NeuroFrontAccount.getState().error)
    await page.evaluate(() => NeuroFrontAccount.signIn("b@example.test", "synthetic-password"))
    offline = false
    await page.evaluate(() => NeuroFrontAccount.retry())
    await page.waitForFunction(() => NeuroFrontAccount.owner() === "b" && !NeuroFrontAccount.getState().loading)
    assert.equal(await page.evaluate(() => chatPrivate), "")
    assert.equal(await page.evaluate(() => NeuroFrontAccount.getState().captures.length), 0)
    assert.equal(database.get("b").captures.length, 0)
    assert.ok(!calls.some(call => call.id === "b" && call.body?.p_id === "capture-stable-3"))
    await page.evaluate(() => NeuroFrontAccount.signIn("a@example.test", "synthetic-password"))
    await page.waitForFunction(() => NeuroFrontAccount.getState().status === "saved" && NeuroFrontAccount.captureSaved("capture-stable-3"))
    assert.equal(database.get("a").captures.length, 3)
    assert.equal(await page.evaluate(id => NeuroFrontAccount.getState().threads.find(row => row.id === id).messages.length, thread.id), 3)
    assert.deepEqual((await page.evaluate(() => NeuroFrontAccount.getState().captures)).find(item => item.id === capture.id).baseline, capture.baseline)

    const preservedBaseline = structuredClone(database.get("a").baselines)
    const activeBaseline = database.get("a").profile.active_baseline_id
    const preservedMessages = database.get("a").messages.map(message => message.payload.content)
    const originalResetCount = await page.evaluate(() => device.resetCount)
    await page.evaluate(() => { device.active = true })
    const deleted = await page.evaluate(id => NeuroFrontAccount.deleteCapture(id, "a"), capture.id)
    assert.deepEqual(deleted, { pending: false })
    assert.equal(database.get("a").captures.some(row => row.id === capture.id), false)
    assert.equal(await page.evaluate(() => device.active), true, "Deleting a past capture must preserve the active capture")
    assert.equal(await page.evaluate(() => device.resetCount), originalResetCount)
    assert.deepEqual(database.get("a").baselines, preservedBaseline)
    assert.equal(database.get("a").profile.active_baseline_id, activeBaseline)
    assert.deepEqual(database.get("a").messages.map(message => message.payload.content), preservedMessages)
    assert.ok(database.get("a").messages.every(message => !message.payload.captureId))
    assert.ok(database.get("a").threads.every(row => !row.capture_id))
    assert.equal(await page.evaluate(id => NeuroFrontAccount.captureSaved(id), capture.id), false)
    await page.evaluate(() => { device.active = false })
    const deleteCalls = calls.filter(call => call.path.endsWith("nf_delete_capture")).length
    await page.evaluate(id => NeuroFrontAccount.deleteCapture(id, "a"), capture.id)
    await page.evaluate(value => NeuroFrontAccount.saveCapture(value, "a"), capture)
    assert.equal(calls.filter(call => call.path.endsWith("nf_delete_capture")).length, deleteCalls)
    assert.equal(database.get("a").captures.some(row => row.id === capture.id), false, "Stale local saves cannot restore deleted records")
    await assert.rejects(page.evaluate(() => NeuroFrontAccount.deleteCapture("capture-stable-2", "b")), /authentication/)
    await assert.rejects(page.evaluate(() => NeuroFrontAccount.deleteCapture("other-owner-record", "a")), /capture/)

    await page.evaluate(value => {
      const saved = NeuroFrontAccount.getState().threads.find(row => row.id === value.id)
      return NeuroFrontAccount.saveThread({ ...saved, capture_id: fixture.capture.id, messages: saved.messages.map(message => ({ ...message, captureId: fixture.capture.id })) }, "a")
    }, thread)
    await page.waitForFunction(() => NeuroFrontAccount.getState().status === "saved")
    assert.equal(database.get("a").threads.find(row => row.id === thread.id).capture_id, null)
    assert.ok(database.get("a").messages.every(message => !message.payload.captureId), "Stale conversation context must be sanitized")

    offline = true
    const deleteSecond = await page.evaluate(() => NeuroFrontAccount.deleteCapture("capture-stable-2", "a"))
    assert.deepEqual(deleteSecond, { pending: true })
    assert.deepEqual(await page.evaluate(() => NeuroFrontAccount.getState().pendingCaptureDeletes), ["capture-stable-2"])
    assert.equal(await page.evaluate(() => NeuroFrontAccount.getState().captures.some(row => row.id === "capture-stable-2")), false)
    assert.equal(database.get("a").captures.some(row => row.id === "capture-stable-2"), true)
    await page.close()
    page = await pageWithStore()
    await page.waitForFunction(() => NeuroFrontAccount.getState().error && NeuroFrontAccount.getState().pendingCaptureDeletes.length === 1)
    assert.equal(await page.evaluate(() => NeuroFrontAccount.getState().captures.some(row => row.id === "capture-stable-2")), false)
    database.get("b").captures.push({ ...structuredClone(database.get("a").captures.find(row => row.id === "capture-stable-2")), owner_id: "b" })
    await page.evaluate(() => NeuroFrontAccount.signIn("b@example.test", "synthetic-password"))
    offline = false
    await page.evaluate(() => NeuroFrontAccount.retry())
    await page.waitForFunction(() => NeuroFrontAccount.owner() === "b" && NeuroFrontAccount.getState().status === "saved")
    assert.equal(database.get("b").captures.length, 1)
    assert.ok(!calls.some(call => call.id === "b" && call.path.endsWith("nf_delete_capture")), "A's pending deletion must not be sent as B")
    await page.evaluate(() => NeuroFrontAccount.signIn("a@example.test", "synthetic-password"))
    await page.waitForFunction(() => NeuroFrontAccount.getState().status === "saved" && !NeuroFrontAccount.getState().pendingCaptureDeletes.length)
    assert.equal(database.get("a").captures.some(row => row.id === "capture-stable-2"), false)
    assert.equal(database.get("b").captures.length, 1)

    offline = true
    const unsaved = { ...structuredClone(capture), id: "delete-before-upload" }
    await page.evaluate(value => NeuroFrontAccount.saveCapture(value, "a"), unsaved)
    await page.waitForFunction(() => NeuroFrontAccount.getState().error)
    await page.evaluate(id => NeuroFrontAccount.deleteCapture(id, "a"), unsaved.id)
    const callsBeforeRetry = calls.length
    offline = false
    await page.evaluate(() => NeuroFrontAccount.retry())
    await page.waitForFunction(() => NeuroFrontAccount.getState().status === "saved")
    assert.equal(database.get("a").captures.some(row => row.id === unsaved.id), false)
    assert.ok(!calls.slice(callsBeforeRetry).some(call => call.path.endsWith("nf_save_capture") && call.body?.p_id === unsaved.id), "Queued create must be cancelled before deletion retry")

    const racing = { ...structuredClone(capture), id: "delete-inflight-upload" }
    heldCaptureSaveId = racing.id
    await page.evaluate(value => NeuroFrontAccount.saveCapture(value, "a"), racing)
    for (let attempt = 0; !releaseCaptureSave && attempt < 200; attempt++) await new Promise(resolve => setTimeout(resolve, 10))
    assert.ok(releaseCaptureSave, "Synthetic capture upload must be held in flight")
    assert.deepEqual(await page.evaluate(id => NeuroFrontAccount.deleteCapture(id, "a"), racing.id), { pending: true })
    releaseCaptureSave(); heldCaptureSaveId = null
    await page.waitForFunction(() => NeuroFrontAccount.getState().status === "saved")
    assert.equal(database.get("a").captures.some(row => row.id === racing.id), false, "Delete must follow an already in-flight create")
    assert.equal(await page.evaluate(id => NeuroFrontAccount.getState().captures.some(row => row.id === id), racing.id), false)

    const staleRemote = { ...structuredClone(capture), id: "remote-tombstone" }
    offline = true
    await page.evaluate(value => NeuroFrontAccount.saveCapture(value, "a"), staleRemote)
    await page.waitForFunction(() => NeuroFrontAccount.getState().error)
    database.get("a").capture_deletions.push({ owner_id: "a", id: staleRemote.id, deleted_at: new Date().toISOString() })
    offline = false
    await page.evaluate(() => NeuroFrontAccount.retry())
    await page.waitForFunction(() => NeuroFrontAccount.getState().status === "saved")
    assert.equal(database.get("a").captures.some(row => row.id === staleRemote.id), false)
    assert.equal(await page.evaluate(id => NeuroFrontAccount.getState().captures.some(row => row.id === id), staleRemote.id), false, "P0002 must discard a stale queued upload, not retry forever")

    const cacheFailure = { ...structuredClone(capture), id: "delete-cache-failure" }
    await page.evaluate(value => NeuroFrontAccount.saveCapture(value, "a"), cacheFailure)
    await page.waitForFunction(() => NeuroFrontAccount.getState().status === "saved")
    await page.evaluate(() => {
      window.originalCachePut = IDBObjectStore.prototype.put
      IDBObjectStore.prototype.put = function (value, ...args) {
        if (value?.outbox?.some(op => op.type === "captureDelete" && op.recordId === "delete-cache-failure")) throw new DOMException("Synthetic quota failure", "QuotaExceededError")
        return originalCachePut.call(this, value, ...args)
      }
    })
    await assert.rejects(page.evaluate(id => NeuroFrontAccount.deleteCapture(id, "a"), cacheFailure.id), /storage/)
    await page.evaluate(() => { IDBObjectStore.prototype.put = originalCachePut })
    assert.equal(await page.evaluate(id => NeuroFrontAccount.getState().captures.some(row => row.id === id), cacheFailure.id), true, "Failed durable queue write must not hide the record")
    assert.ok(database.get("a").captures.some(row => row.id === cacheFailure.id))
    assert.ok(!calls.some(call => call.path.endsWith("nf_delete_capture") && call.body?.p_id === cacheFailure.id))
    await page.evaluate(() => NeuroFrontAccount.retry())
    await page.waitForFunction(() => NeuroFrontAccount.getState().status === "saved")
    assert.deepEqual(database.get("a").baselines, preservedBaseline)
    assert.equal(database.get("a").profile.active_baseline_id, activeBaseline)
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ syntheticSupabaseAndRecords: true, deliberateIdempotentGuestImport: true, linkedBaselineAndExactSnapshot: true, duplicateSafeThreadRevisions: true, staleThreadPreservedAsSeparateConversation: true, offlineQueueSurvivesRefresh: true, retrySavesOnce: true, stalePreferencesConflict: true, independentBrowserContextRestoresCloudData: true, activeCaptureBlocksAccountAction: true, accountSwitchClearsChat: true, ownerScopedPendingUploads: true, restoredConversationsAndBaseline: true, accountCaptureDeletion: true, baselineAndActiveCapturePreserved: true, deletionDetachesChatWithoutErasingText: true, deleteOfflineRefreshAndOwnerIsolation: true, cancelledPendingCreate: true, deletionAfterInflightUpload: true, serverTombstoneRejectsStaleUpload: true, failedDeleteCacheKeepsRecordVisible: true, errors }, null, 2))
  } finally { await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve)) }
})().catch(error => { console.error(error); process.exitCode = 1 })
