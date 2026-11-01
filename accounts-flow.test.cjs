"use strict"

// Full dashboard integration using simulated Bluetooth, Supabase Auth/REST and AI.
// No physical device, real account, email, cloud write or model request is used.
const assert = require("node:assert/strict")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const { classify } = require("./score-config.js")
const url = process.env.NEUROFRONT_URL || "http://127.0.0.1:5183"
const A = "11111111-1111-4111-8111-111111111111"
const B = "22222222-2222-4222-8222-222222222222"
const copy = value => structuredClone(value)
const sdk = `window.supabase={createClient(){let session=JSON.parse(localStorage.getItem("synthetic-auth")||"null"),listener=()=>{};window.syntheticSwitch=id=>{session=id?{user:{id,email:id+"@example.test",user_metadata:{}},access_token:"synthetic-token-"+id}:null;localStorage.setItem("synthetic-auth",JSON.stringify(session));listener(id?"SIGNED_IN":"SIGNED_OUT",session)};return{auth:{onAuthStateChange(fn){listener=fn},async getSession(){return{data:{session},error:null}},async signInWithPassword({email}){syntheticSwitch(email.startsWith("a@")?"${A}":"${B}");return{data:{session},error:null}},async signOut(){syntheticSwitch(null);return{error:null}},async signUp(){return{data:{session:null},error:null}},async resetPasswordForEmail(){return{error:null}},async updateUser(){return{error:null}}}}}}`

;(async () => {
  const database = new Map([A, B].map(id => [id, { profile: { id, display_name: id === A ? "Account A" : "Account B", avatar_path: null, preferences: { language: "en", resourcesExpanded: false }, active_baseline_id: null, revision: 1 }, baselines: [], captures: [], threads: [], messages: [] }]))
  const calls = [], errors = [], assistantRequests = []
  let baselineGate = null
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined })
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, acceptDownloads: true })
  const backend = async route => {
    const request = route.request(), parsed = new URL(request.url())
    const owner = request.headers().authorization?.replace("Bearer synthetic-token-", "")
    const db = database.get(owner), body = request.method() === "POST" ? request.postDataJSON() : null
    calls.push({ owner, path: parsed.pathname, body: copy(body) })
    const respond = (status, value) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) })
    if (!db) return respond(401, { code: "unauthorized" })
    const name = parsed.pathname.split("/").at(-1)
    if (!parsed.pathname.includes("/rpc/")) {
      if (parsed.searchParams.get(name === "nf_profiles" ? "id" : "owner_id") !== `eq.${owner}`) return respond(403, { code: "ownership" })
      return respond(200, name === "nf_profiles" ? [db.profile] : db[name.replace("nf_", "")] || [])
    }
    if (name === "nf_save_baseline") {
      if (baselineGate) await baselineGate
      let row = db.baselines.find(item => item.id === body.p_id)
      if (row && JSON.stringify(row.payload) !== JSON.stringify(body.p_payload)) return respond(409, { code: "23505" })
      if (!row) { row = { id: body.p_id, owner_id: owner, payload: copy(body.p_payload) }; db.baselines.push(row) }
      return respond(200, row)
    }
    if (name === "nf_save_capture") {
      const baseline = db.baselines.find(item => item.id === body.p_baseline_id)
      if (!baseline) return respond(400, { code: "23503" })
      assert.equal(body.p_payload.baseline.createdAt, baseline.payload.createdAt)
      assert.deepEqual(body.p_payload.baseline.samples, baseline.payload.samples)
      for (const [key, value] of Object.entries(baseline.payload.features)) assert.equal(body.p_payload.baseline[key], value)
      assert.equal(body.p_payload.stress.label, classify(body.p_payload.stress.score).label)
      let row = db.captures.find(item => item.id === body.p_id)
      if (row && JSON.stringify(row.payload) !== JSON.stringify(body.p_payload)) return respond(409, { code: "23505" })
      if (!row) { row = { id: body.p_id, owner_id: owner, baseline_id: body.p_baseline_id, payload: copy(body.p_payload) }; db.captures.push(row) }
      return respond(200, row)
    }
    if (name === "nf_save_profile") {
      const changes = { display_name: body.p_display_name, avatar_path: body.p_avatar_path, preferences: body.p_preferences, active_baseline_id: body.p_active_baseline_id }
      if (changes.active_baseline_id && !db.baselines.some(item => item.id === changes.active_baseline_id)) return respond(400, { code: "23503" })
      if (db.profile.revision !== body.p_expected_revision) {
        if (db.profile.revision === body.p_expected_revision + 1 && Object.keys(changes).every(key => JSON.stringify(changes[key]) === JSON.stringify(db.profile[key]))) return respond(200, db.profile)
        return respond(409, { code: "40001" })
      }
      db.profile = { ...db.profile, ...copy(changes), revision: db.profile.revision + 1 }
      return respond(200, db.profile)
    }
    if (name === "nf_save_thread") {
      let row = db.threads.find(item => item.id === body.p_id)
      if ((row?.revision || 0) !== body.p_expected_revision) return respond(409, { code: "40001" })
      if (body.p_capture_id && !db.captures.some(item => item.id === body.p_capture_id)) return respond(400, { code: "23503" })
      for (const message of body.p_messages) {
        assert.ok(["pending", "completed", "failed", "stopped", "cancelled"].includes(message.payload.status))
        if (message.payload.captureId && !db.captures.some(item => item.id === message.payload.captureId)) return respond(400, { code: "23503" })
      }
      row = { id: body.p_id, owner_id: owner, title: body.p_title, capture_id: body.p_capture_id, revision: (row?.revision || 0) + 1 }
      db.threads = db.threads.filter(item => item.id !== row.id).concat(row)
      db.messages = db.messages.filter(item => item.thread_id !== row.id).concat(body.p_messages.map(message => ({ ...copy(message), owner_id: owner, thread_id: row.id })))
      return respond(200, row)
    }
    return respond(400, { code: "unknown_rpc" })
  }
  const install = async target => {
    await target.route("**/api/account-config", route => route.fulfill({ contentType: "application/json", body: JSON.stringify({ configured: true, url: "https://synthetic.supabase.co", publishableKey: "sb_publishable_synthetic" }) }))
    await target.route("**/supabase-2.118.0.js", route => route.fulfill({ contentType: "application/javascript", body: sdk }))
    await target.route("https://synthetic.supabase.co/**", backend)
    await target.route("**/api/assistant", route => {
      assistantRequests.push({ body: route.request().postDataJSON(), authorization: route.request().headers().authorization })
      return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "unavailable" } }) })
    })
    await target.addInitScript(() => {
      const characteristic = new EventTarget(), device = new EventTarget()
      const calls = { discovery: 0, connect: 0, disconnect: 0, notifications: 0, services: [], characteristics: [] }
      characteristic.startNotifications = async () => { calls.notifications++; return characteristic }
      device.gatt = { connected: false, async connect() { calls.connect++; this.connected = true; return this }, disconnect() { calls.disconnect++; this.connected = false; device.dispatchEvent(new Event("gattserverdisconnected")) }, async getPrimaryService(id) { calls.services.push(id); return { async getCharacteristic(id) { calls.characteristics.push(id); return characteristic } } } }
      Object.defineProperty(navigator, "bluetooth", { value: { async requestDevice(options) { calls.discovery++; calls.filters = options.filters; return device } } })
      window.syntheticBle = { device, calls, emit(value) { characteristic.value = new DataView(new TextEncoder().encode(`${value},36.5,4.1`).buffer); characteristic.dispatchEvent(new Event("characteristicvaluechanged")) } }
    })
  }
  await install(context)
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  page.on("pageerror", error => errors.push(error.message))
  const saved = () => page.waitForFunction(() => NeuroFrontAccount.getState().status === "saved")
  const ready = async target => {
    await target.goto(url)
    await target.waitForFunction(() => window.NeuroFrontAccount?.getState().configured && document.body.classList.contains("is-ready") && state.chart)
  }
  const calibrate = async scale => {
    await page.locator("#recalibrateButton").click()
    assert.equal(await page.evaluate(() => state.calibration.active), true)
    assert.equal(await page.locator("#calibrationProgressButton").isVisible(), true)
    return page.evaluate(scale => {
      const samples = []
      for (let i = 0; i < 400; i++) { const value = scale * (Math.sin(i / 5) * 12 + Math.cos(i / 2) * 2); samples.push(value); syntheticBle.emit(value) }
      state.calibration.startTime -= 20000
      updateMeasurement(performance.now())
      return { samples, baseline: structuredClone(state.savedBaseline), ready: state.baseline.ready, active: state.calibration.active, timer: document.getElementById("countdownValue").textContent }
    }, scale)
  }
  const begin = async () => {
    await page.locator("#measureButton").click()
    assert.equal(await page.evaluate(() => state.measurement.active), false)
    assert.equal(await page.locator("#setupImageDialog").isVisible(), true)
    await page.locator("#beginMeasurementButton").click()
    assert.equal(await page.evaluate(() => state.measurement.active), true)
  }
  const finish = async () => page.evaluate(() => {
    const samples = state.measurement.samples.slice()
    for (let i = samples.length; i < 300; i++) { const value = Math.sin(i / 7) * 20 + Math.cos(i / 3) * 3; samples.push(value); syntheticBle.emit(value); pushSignalSample(value); updateAxisLabels() }
    state.measurement.startTime -= 15000
    updateMeasurement(performance.now())
    return { samples, capture: structuredClone(NeuroFrontHistory.getLatest()), active: state.measurement.active, timer: document.getElementById("countdownValue").textContent }
  })
  try {
    await ready(page)
    assert.equal(await page.evaluate(() => NeuroFrontAccount.owner()), null)
    await page.locator("#connectButton").click()
    await page.waitForFunction(() => state.characteristic)
    assert.equal(await page.evaluate(() => state.calibration.active), false)
    const guestBaseline = await calibrate(1)
    assert.equal(guestBaseline.ready, true)
    assert.equal(guestBaseline.active, false)
    assert.equal(guestBaseline.baseline.samples.length, 400)
    assert.deepEqual(guestBaseline.baseline.samples, guestBaseline.samples)
    await begin()
    const guest = await finish()
    assert.equal(guest.active, false)
    assert.equal(guest.capture.durationMs, 15000)
    assert.deepEqual(guest.capture.samples, guest.samples)
    await page.waitForFunction(async () => (await NeuroFrontHistory.readGuestCaptures()).length === 1)
    const bleBefore = await page.evaluate(() => structuredClone(syntheticBle.calls))
    assert.deepEqual(bleBefore.services, ["12345678-1234-1234-1234-1234567890ab"])
    assert.deepEqual(bleBefore.characteristics, ["abcd1234-5678-1234-5678-abcdef123456"])
    assert.equal(bleBefore.discovery, 1)
    assert.equal(bleBefore.notifications, 1)

    await page.evaluate(() => NeuroFrontAccount.signIn("a@example.test", "synthetic-password"))
    await saved()
    await page.waitForFunction(() => NeuroFrontAccount.getState().guestAvailable)
    assert.equal(database.get(A).captures.length, 0, "Sign-in never silently imports guest data")
    assert.equal(database.get(A).baselines.length, 0)
    assert.equal(await page.locator("#savedBaselineButton").isDisabled(), true)
    assert.deepEqual(await page.evaluate(() => structuredClone(syntheticBle.calls)), bleBefore)
    await page.evaluate(() => NeuroFrontAccount.importGuest())
    await saved()
    await page.evaluate(() => NeuroFrontAccount.importGuest())
    await saved()
    assert.equal(database.get(A).captures.length, 1)
    assert.equal(database.get(A).baselines.length, 1)
    assert.deepEqual(database.get(A).captures[0].payload, guest.capture)
    assert.equal(await page.locator("#savedBaselineButton").isDisabled(), false)

    let confirmBaseline
    baselineGate = new Promise(resolve => { confirmBaseline = resolve })
    const accountBaseline = await calibrate(1.3)
    await page.waitForFunction(() => NeuroFrontAccount.getState().pending > 0)
    assert.notEqual(await page.locator("#baselineActionStatus").textContent(), await page.evaluate(() => NEUROFRONT_TRANSLATIONS.en["account.saved"]))
    assert.equal(database.get(A).baselines.length, 1, "Cloud saved state waits for the baseline acknowledgement")
    baselineGate = null; confirmBaseline()
    await page.waitForFunction(date => NeuroFrontAccount.getState().baselines.some(row => row.payload.createdAt === date && row.id === NeuroFrontAccount.getState().profile?.active_baseline_id), accountBaseline.baseline.createdAt)
    await saved()
    await page.waitForFunction(() => document.getElementById("baselineActionStatus").textContent === NEUROFRONT_TRANSLATIONS.en["account.saved"])
    assert.equal(await page.locator("#measurementState").textContent(), await page.evaluate(() => NEUROFRONT_TRANSLATIONS.en["account.saved"]))
    assert.equal(database.get(A).baselines.length, 2)
    const baselineRow = database.get(A).baselines.find(row => row.id === database.get(A).profile.active_baseline_id)
    assert.deepEqual(baselineRow.payload, accountBaseline.baseline)
    assert.deepEqual(accountBaseline.baseline.samples, accountBaseline.samples)
    await begin()
    const completed = await finish()
    await page.waitForFunction(id => NeuroFrontAccount.captureSaved(id), completed.capture.id)
    await saved()
    assert.equal(database.get(A).captures.length, 2)
    assert.equal(completed.active, false)
    assert.equal(completed.capture.durationMs, 15000)
    assert.deepEqual(completed.capture.samples, completed.samples)
    const savedCapture = copy(database.get(A).captures.find(row => row.id === completed.capture.id))
    assert.deepEqual(savedCapture.payload, completed.capture)
    assert.equal(savedCapture.baseline_id, baselineRow.id)
    assert.equal(completed.capture.stress.label, classify(completed.capture.stress.score).label)
    assert.equal(assistantRequests.length, 0)

    await page.locator("#getMeasurementExplanation").click()
    await page.waitForFunction(() => !document.getElementById("assistantSend").disabled && document.querySelector('[data-kind="preset"]'))
    await saved()
    assert.equal(assistantRequests.length, 1)
    assert.equal(assistantRequests[0].body.accountCaptureId, completed.capture.id)
    assert.equal(assistantRequests[0].body.context, null)
    assert.equal(assistantRequests[0].authorization, `Bearer synthetic-token-${A}`)
    assert.ok(database.get(A).messages.some(message => message.payload.kind === "preset" && message.payload.captureId === completed.capture.id))
    assert.ok(database.get(A).messages.some(message => message.payload.status === "failed"))
    assert.ok(!database.get(A).messages.some(message => message.payload.kind === "request" && message.payload.status === "completed"))
    await page.locator("#assistantClose").click()

    await page.locator("#measureAgainButton").click()
    const newBaseline = await calibrate(1.7)
    await page.waitForFunction(date => NeuroFrontAccount.getState().baselines.some(row => row.payload.createdAt === date && row.id === NeuroFrontAccount.getState().profile?.active_baseline_id), newBaseline.baseline.createdAt)
    await saved()
    assert.equal(database.get(A).baselines.length, 3)
    assert.notEqual(database.get(A).profile.active_baseline_id, savedCapture.baseline_id)
    assert.deepEqual(database.get(A).captures.find(row => row.id === completed.capture.id), savedCapture)
    assert.notEqual(newBaseline.baseline.createdAt, accountBaseline.baseline.createdAt)
    await page.locator(`[data-capture-id="${completed.capture.id}"]`).click()
    const historicalTrace = await page.locator("#captureGraph").innerHTML()
    assert.ok(historicalTrace.includes("path"))
    const downloadPromise = page.waitForEvent("download")
    await page.locator("#captureExport").click()
    const download = await downloadPromise
    assert.match(download.suggestedFilename(), /\.png$/i)
    assert.equal(await download.failure(), null)
    await page.keyboard.press("Escape")

    await page.evaluate(() => NeuroFrontAccount.signOut())
    await page.waitForFunction(() => !NeuroFrontAccount.owner())
    assert.equal(await page.evaluate(() => syntheticBle.device.gatt.connected), true)
    assert.deepEqual(await page.evaluate(() => structuredClone(syntheticBle.calls)), bleBefore)
    assert.equal(await page.locator(".assistant-message").count(), 0)
    assert.equal(await page.locator("#assistantContext").isVisible(), false)
    assert.equal(await page.locator(`[data-capture-id="${completed.capture.id}"]`).count(), 0)
    assert.equal(await page.evaluate(() => state.savedBaseline.createdAt), guestBaseline.baseline.createdAt)

    await page.evaluate(() => NeuroFrontAccount.signIn("a@example.test", "synthetic-password"))
    await saved()
    assert.equal(await page.evaluate(() => NeuroFrontAccount.getState().captures.length), 2)
    assert.equal(await page.evaluate(() => NeuroFrontAccount.getState().threads.length), 1)
    await page.locator("#savedBaselineButton").click()
    await begin()
    const interruptedId = await page.evaluate(() => { for (let i = 0; i < 15; i++) { syntheticBle.emit(i); pushSignalSample(i) } return state.measurement.id })
    await page.evaluate(id => syntheticSwitch(id), B)
    await page.waitForFunction(id => NeuroFrontAccount.owner() === id && NeuroFrontAccount.getState().status === "saved", B)
    assert.equal(await page.evaluate(() => state.measurement.active), false)
    assert.equal(await page.evaluate(() => syntheticBle.device.gatt.connected), true)
    assert.equal(await page.locator(".assistant-message").count(), 0)
    assert.equal(database.get(B).captures.length, 0)
    assert.ok(!database.get(A).captures.some(row => row.id === interruptedId))
    assert.ok(!calls.some(call => call.body?.p_id === interruptedId))
    assert.equal(await page.locator("#savedBaselineButton").isDisabled(), true)
    assert.deepEqual(await page.evaluate(() => structuredClone(syntheticBle.calls)), bleBefore)

    const otherContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    try {
      await install(otherContext)
      const other = await otherContext.newPage()
      other.on("pageerror", error => errors.push(error.message))
      await ready(other)
      await other.evaluate(() => NeuroFrontAccount.signIn("a@example.test", "synthetic-password"))
      await other.waitForFunction(() => NeuroFrontAccount.getState().status === "saved")
      assert.equal(await other.evaluate(() => NeuroFrontAccount.getState().captures.length), 2)
      assert.equal(await other.evaluate(() => NeuroFrontAccount.getState().threads.length), 1)
      await other.locator("#connectButton").click()
      await other.waitForFunction(() => state.characteristic)
      await other.locator("#savedBaselineButton").click()
      assert.equal(await other.evaluate(() => state.baseline.ready), true)
      assert.equal(await other.evaluate(() => state.baseline.createdAt), newBaseline.baseline.createdAt)
      assert.deepEqual(await other.evaluate(() => state.baseline.samples), newBaseline.baseline.samples)
      assert.equal(await other.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
    } finally { await otherContext.close() }
    assert.deepEqual(errors, [])
    console.log(JSON.stringify({ simulatedSupabaseBleAndAI: true, actualDashboardAndCalculations: true, calibration400RealNotificationSamples: true, capture15SecondOrchestration300Samples: true, explicitDuplicateSafeGuestImport: true, exactCloudBaselineAndCapture: true, baselineSavedOnlyAfterAcknowledgement: true, immutableHistoricalSnapshotAfterRecalibration: true, failedChatStatusAndExactCaptureContext: true, historicalPNGExport: true, signOutPreservesBluetooth: true, forcedSwitchCancelsWithoutWrongOwnerCapture: true, separateBrowserRestoresActualSavedBaseline: true, mobileOverflow: false, errors }, null, 2))
  } finally { await context.close(); await browser.close() }
})().catch(error => { console.error(error); process.exitCode = 1 })
