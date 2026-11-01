(() => {
  "use strict"
  const clone = value => value == null ? value : structuredClone(value)
  const uid = () => crypto.randomUUID()
  const featureKeys = ["mean", "rms", "stdDev", "peakToPeak", "derivativeMean"]
  const buckets = new Map(), writes = new Map()
  const threadRevisions = new Map()
  let config = null, client = null, user = null, bucket = null, epoch = 0
  let loading = false, configured = false, error = "", conflict = false, guestAvailable = false
  let loadController = null, flushController = null, flushWork = null, dbPromise = null
  let applying = false, lastReload = 0, initialized = false, avatarUrl = ""
  const owner = () => user?.id || null
  const busy = () => window.NeuroFrontDevice?.busy() || false
  const current = (id, generation = epoch) => owner() === id && epoch === generation
  const empty = id => ({ owner: id, profile: null, baselines: [], captures: [], threads: [], outbox: [] })
  const fail = code => { const e = new Error(code); e.code = code; return e }
  const event = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }))
  const snapshot = () => ({ user: user && { id: user.id, email: user.email },
    profile: bucket?.profile ? { ...clone(bucket.profile), avatarUrl } : null,
    baselines: clone(bucket?.baselines || []), captures: clone(bucket?.captures || []), threads: clone(bucket?.threads || []),
    configured, loading, pending: bucket?.outbox.length || 0, error, conflict, guestAvailable, busy: busy(),
    status: loading ? "loading" : conflict ? "conflict" : error ? "error" : bucket?.outbox.length ? "pending" : user ? "saved" : "guest" })
  function emit() { event("neurofront:accountchange", snapshot()) }
  function database() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open("neurofront-account-cache", 1)
      request.onupgradeneeded = () => request.result.createObjectStore("owners", { keyPath: "owner" })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
      request.onblocked = () => reject(fail("storage"))
    }).catch(e => { dbPromise = null; throw e })
    return dbPromise
  }
  async function readCache(id) {
    if (buckets.has(id)) return buckets.get(id)
    try {
      const db = await database()
      const value = await new Promise((resolve, reject) => {
        const request = db.transaction("owners").objectStore("owners").get(id)
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      })
      const result = value?.owner === id && Array.isArray(value.outbox) ? value : empty(id)
      buckets.set(id, result)
      return result
    } catch { const result = empty(id); buckets.set(id, result); return result }
  }
  function cache(value) {
    const work = (writes.get(value.owner) || Promise.resolve()).catch(() => {}).then(async () => {
      const db = await database()
      return new Promise((resolve, reject) => {
        const tx = db.transaction("owners", "readwrite")
        tx.objectStore("owners").put(clone(value))
        tx.oncomplete = resolve
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      })
    })
    writes.set(value.owner, work)
    return work.catch(() => { if (owner() === value.owner) { error = "storage"; emit() } })
  }
  async function accessToken(expected = owner()) {
    if (!client || !expected || owner() !== expected) throw fail("authentication")
    const { data, error: authError } = await client.auth.getSession()
    if (authError || data.session?.user.id !== expected || owner() !== expected) throw fail("authentication")
    return data.session.access_token
  }
  async function cloud(path, options = {}, expected = owner(), signal) {
    const token = await accessToken(expected)
    const deadline = AbortSignal.timeout(15000)
    const response = await fetch(config.url + path, { ...options, signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...options.headers } })
    let data = null
    try { data = await response.json() } catch {}
    if (!response.ok) throw fail(data?.code === "40001" ? "conflict" : response.status === 401 ? "authentication" : "sync")
    return data
  }
  const rpc = (name, data, id, signal) => cloud(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(data) }, id, signal)
  async function rows(table, id, signal, extra = "") {
    const result = []
    for (let offset = 0; ; offset += 100) {
      const order = table === "nf_messages" ? "thread_id,ordinal" : "id"
      const query = `?owner_id=eq.${encodeURIComponent(id)}&select=*&order=${order}&offset=${offset}&limit=100${extra}`
      const page = await cloud(`/rest/v1/${table}${query}`, {}, id, signal)
      if (!Array.isArray(page)) throw fail("sync")
      result.push(...page)
      if (page.length < 100) return result
    }
  }
  function put(list, item) {
    const index = list.findIndex(value => value.id === item.id)
    if (index < 0) list.push(item)
    else list[index] = item
  }
  function applyPreferences() {
    applying = true
    try {
      const preferences = bucket?.profile?.preferences || {}
      window.NeuroFrontI18n?.select(preferences.language || "en", false)
      window.NeuroFrontResources?.setExpanded(preferences.resourcesExpanded === true, false)
      const active = bucket?.baselines.find(row => row.id === bucket.profile?.active_baseline_id)
      window.NeuroFrontDevice?.setSavedBaseline(active?.payload || null)
    } finally { applying = false }
  }
  async function loadAvatar(id, generation) {
    avatarUrl = ""
    const path = bucket?.profile?.avatar_path
    if (!path || !path.startsWith(id + "/")) return
    try {
      const result = await cloud(`/storage/v1/object/sign/nf-avatars/${path.split("/").map(encodeURIComponent).join("/")}`, { method: "POST", body: JSON.stringify({ expiresIn: 3600 }) }, id, loadController?.signal)
      if (current(id, generation) && result.signedURL?.startsWith("/object/sign/")) avatarUrl = config.url + "/storage/v1" + result.signedURL
    } catch { /* Initials remain available when image storage is unavailable. */ }
  }
  async function refresh(discardConflicts = false) {
    const id = owner(), generation = epoch
    if (!id || loading) return
    if (busy()) { if (discardConflicts) throw fail("activeCapture"); return }
    if (discardConflicts && bucket) {
      const forks = new Map()
      for (const op of bucket.outbox) {
        if (op.type === "thread") {
          if (!forks.has(op.recordId)) forks.set(op.recordId, uid())
          op.recordId = forks.get(op.recordId)
          op.payload.id = op.recordId
          op.payload.revision = 0
          op.expectedRevision = 0
        }
      }
      bucket.outbox = bucket.outbox.filter(op => op.type !== "profile")
      await cache(bucket)
      window.NeuroFrontAssistant?.resetForAccount()
      conflict = false
    }
    loading = true; error = ""; emit()
    loadController?.abort(); loadController = new AbortController()
    const signal = loadController.signal
    try {
      let profiles = await cloud(`/rest/v1/nf_profiles?id=eq.${encodeURIComponent(id)}&select=*`, {}, id, signal)
      if (!profiles.length) {
        const profile = await rpc("nf_save_profile", { p_expected_revision: 0, p_display_name: String(user.user_metadata?.display_name || "").slice(0, 80), p_avatar_path: null, p_preferences: {}, p_active_baseline_id: null }, id, signal)
        profiles = [Array.isArray(profile) ? profile[0] : profile]
      }
      const [baselines, captures, threads, messages] = await Promise.all([
        rows("nf_baselines", id, signal), rows("nf_captures", id, signal), rows("nf_threads", id, signal), rows("nf_messages", id, signal)
      ])
      if (!current(id, generation)) return
      const pending = bucket.outbox
      bucket.profile = profiles[0]
      bucket.baselines = baselines
      bucket.captures = captures.map(row => ({ ...row.payload, cloudSaved: true }))
      bucket.threads = threads.map(row => ({ ...row, messages: messages.filter(message => message.thread_id === row.id).sort((a, b) => a.ordinal - b.ordinal).map(message => ({ ...message.payload, id: message.id })) }))
      for (const op of pending) {
        if (op.type === "baseline") put(bucket.baselines, { id: op.recordId, payload: op.payload })
        if (op.type === "capture") put(bucket.captures, { ...op.payload, cloudSaved: false })
        if (op.type === "thread") put(bucket.threads, op.payload)
        if (op.type === "profile") {
          // The checked RPC distinguishes a stale edit from a retry whose acknowledgement was lost.
          bucket.profile = { ...bucket.profile, ...op.payload }
        }
      }
      bucket.captures.sort((a, b) => b.completedAt.localeCompare(a.completedAt))
      applyPreferences()
      await loadAvatar(id, generation)
      if (!current(id, generation)) return
      await cache(bucket)
      event("neurofront:accountrecords", { owner: id })
      lastReload = Date.now()
    } catch (e) { if (current(id, generation) && e.name !== "AbortError") error = e.code || "sync" }
    finally {
      if (current(id, generation)) { loading = false; emit(); if (!conflict) flush() }
    }
  }
  async function flush() {
    const id = owner(), generation = epoch, active = bucket
    if (!id || !active || loading || conflict || flushWork || !navigator.onLine) return
    flushController = new AbortController()
    const signal = flushController.signal
    const work = (async () => {
      while (current(id, generation) && active.outbox.length && !conflict) {
        const op = active.outbox[0]
        try {
          let saved
          if (op.type === "baseline") saved = await rpc("nf_save_baseline", { p_id: op.recordId, p_payload: op.payload }, id, signal)
          if (op.type === "capture") saved = await rpc("nf_save_capture", { p_id: op.recordId, p_baseline_id: op.baselineId, p_payload: op.payload }, id, signal)
          if (op.type === "profile") saved = await rpc("nf_save_profile", { p_expected_revision: op.expectedRevision,
            p_display_name: op.payload.display_name || "", p_avatar_path: op.payload.avatar_path || null,
            p_preferences: op.payload.preferences || {}, p_active_baseline_id: op.payload.active_baseline_id || null }, id, signal)
          if (op.type === "thread") saved = await rpc("nf_save_thread", { p_id: op.recordId, p_expected_revision: op.expectedRevision,
            p_title: op.payload.title || "", p_capture_id: op.payload.capture_id || null,
            p_messages: op.payload.messages.map((message, ordinal) => ({ id: message.id, ordinal, payload: message })) }, id, signal)
          saved = Array.isArray(saved) ? saved[0] : saved
          active.outbox = active.outbox.filter(entry => entry.id !== op.id)
          if (op.type === "capture") {
            const record = active.captures.find(row => row.id === op.recordId)
            if (record) record.cloudSaved = true
          }
          if (op.type === "profile" || op.type === "thread") {
            const later = active.outbox.filter(entry => entry.type === op.type && entry.recordId === op.recordId)
            for (const entry of later) if (entry.expectedRevision === op.expectedRevision) entry.expectedRevision = saved.revision
            if (op.type === "profile") active.profile = { ...saved, ...(later.at(-1)?.payload || {}) , revision: saved.revision }
            else {
              const thread = active.threads.find(row => row.id === op.recordId)
              if (thread) thread.revision = saved.revision
              const known = threadRevisions.get(`${id}/${op.recordId}`)
              if (known?.revision === op.expectedRevision) known.revision = saved.revision
            }
          }
          await cache(active)
          if (!current(id, generation)) return
          error = ""
          event("neurofront:accountrecords", { owner: id }); emit()
        } catch (e) {
          if (current(id, generation)) { error = e.code || "sync"; conflict = error === "conflict"; emit() }
          break
        }
      }
    })()
    flushWork = work
    try { await work } finally { if (flushWork === work) flushWork = null; if (current(id, generation)) emit() }
  }
  function queueOwned(active, op) {
    if (["baseline", "capture"].includes(op.type) && active.outbox.some(entry => entry.type === op.type && entry.recordId === op.recordId)) return
    active.outbox.push({ ...clone(op), id: uid() })
    cache(active)
    if (owner() === active.owner) { error = ""; emit(); queueMicrotask(flush) }
  }
  function queue(op, expected = owner()) {
    if (!expected || expected !== owner() || !bucket) throw fail("authentication")
    queueOwned(bucket, op)
  }
  function baselineFromCapture(record) {
    const b = record.baseline
    return { schemaVersion: 1, calculationVersion: b.calculationVersion, deviceName: record.device.name,
      serviceUuid: record.device.serviceUuid, characteristicUuid: record.device.characteristicUuid, unit: b.unit,
      sampleIntervalMs: b.sampleIntervalMs, calibrationDurationMs: b.durationMs, createdAt: b.createdAt,
      samples: b.samples.slice(), features: Object.fromEntries(featureKeys.map(key => [key, b[key]])) }
  }
  async function baselineId(record) {
    const canonical = JSON.stringify([record.createdAt, record.calculationVersion, record.deviceName, record.serviceUuid,
      record.characteristicUuid, record.unit, record.sampleIntervalMs, record.calibrationDurationMs,
      featureKeys.map(key => record.features[key]), record.samples])
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical))
    return "b-" + [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("")
  }
  async function saveBaseline(record, activate = true, expected = owner()) {
    if (!window.NeuroFrontDevice.validBaseline(record)) throw fail("baseline")
    if (!expected || expected !== owner() || !bucket) throw fail("authentication")
    const active = bucket
    const id = await baselineId(record)
    if (!active.baselines.some(row => row.id === id)) {
      put(active.baselines, { id, payload: clone(record) })
      queueOwned(active, { type: "baseline", recordId: id, payload: record })
    }
    if (activate && owner() === expected) await setActiveBaseline(id)
    else if (activate && active.profile) {
      const payload = { display_name: active.profile.display_name || "", avatar_path: active.profile.avatar_path || null,
        preferences: active.profile.preferences || {}, active_baseline_id: id }
      queueOwned(active, { type: "profile", recordId: expected, expectedRevision: active.profile.revision, payload })
    }
    return id
  }
  async function saveCapture(record, expected = owner()) {
    if (!window.NeuroFrontHistory.validCapture(record)) throw fail("capture")
    if (!expected || expected !== owner() || !bucket) throw fail("authentication")
    const active = bucket
    const baseline = await saveBaseline(baselineFromCapture(record), false, expected)
    if (!active.captures.some(row => row.id === record.id)) {
      put(active.captures, { ...clone(record), cloudSaved: false })
      queueOwned(active, { type: "capture", recordId: record.id, baselineId: baseline, payload: record })
      if (owner() === expected) event("neurofront:accountrecords", { owner: expected })
    }
    return record.id
  }
  async function updateProfile(patch) {
    if (!bucket?.profile || !owner()) throw fail("authentication")
    if (conflict) throw fail("conflict")
    const profile = bucket.profile
    const payload = { display_name: profile.display_name || "", avatar_path: profile.avatar_path || null,
      preferences: { ...profile.preferences, ...patch.preferences }, active_baseline_id: profile.active_baseline_id || null }
    for (const key of ["display_name", "avatar_path", "active_baseline_id"]) if (Object.hasOwn(patch, key)) payload[key] = patch[key]
    if (typeof payload.display_name !== "string" || payload.display_name.length > 80) throw fail("validation")
    bucket.profile = { ...profile, ...payload }
    queue({ type: "profile", recordId: owner(), expectedRevision: profile.revision, payload })
    if (!busy()) applyPreferences()
  }
  async function setActiveBaseline(id) {
    if (busy()) throw fail("activeCapture")
    if (!bucket?.baselines.some(row => row.id === id && window.NeuroFrontDevice.validBaseline(row.payload))) throw fail("baseline")
    await updateProfile({ active_baseline_id: id })
  }
  async function saveThread(thread, expected = owner()) {
    if (!expected || expected !== owner() || !bucket) throw fail("authentication")
    const key = `${expected}/${thread.id}`, declared = Number(thread.revision) || 0
    let known = threadRevisions.get(key)
    if (!known || known.clientRevision !== declared) {
      known = { clientRevision: declared, revision: declared }
      threadRevisions.set(key, known)
    }
    const value = { ...clone(thread), revision: known.revision, updated_at: new Date().toISOString() }
    put(bucket.threads, value)
    queue({ type: "thread", recordId: value.id, expectedRevision: value.revision, payload: value }, expected)
  }
  async function guestData() {
    let baseline = null
    try { baseline = JSON.parse(localStorage.getItem("neurofront.baseline.v1") || "null") } catch {}
    const captures = await window.NeuroFrontHistory.readGuestCaptures()
    return { baseline: window.NeuroFrontDevice.validBaseline(baseline) ? baseline : null, captures }
  }
  async function importGuest() {
    if (busy()) throw fail("activeCapture")
    const id = owner()
    if (!id) throw fail("authentication")
    const data = await guestData()
    if (data.baseline) await saveBaseline(data.baseline, !bucket.profile?.active_baseline_id, id)
    for (const capture of data.captures) await saveCapture(capture, id)
    await flush()
    emit()
  }
  async function changeSession(session) {
    const next = session?.user || null
    if (next?.id === user?.id) { user = next; emit(); return }
    const generation = ++epoch
    const previousOwner = owner()
    loadController?.abort(); flushController?.abort(); flushWork = null
    threadRevisions.clear()
    user = next; bucket = null; avatarUrl = ""; loading = false; error = ""; conflict = false; guestAvailable = false
    event("neurofront:accountreset", { previousOwner, nextOwner: next?.id || null })
    window.NeuroFrontDevice?.resetForAccount()
    emit()
    if (!next) {
      applying = true
      try {
        let locale = "en", expanded = false
        try { locale = localStorage.getItem("neurofront.language") || "en"; expanded = localStorage.getItem("neurofront.resourcesExpanded") === "true" } catch {}
        window.NeuroFrontI18n.select(locale, false); window.NeuroFrontResources.setExpanded(expanded, false)
        window.NeuroFrontDevice.loadGuestBaseline()
      } finally { applying = false }
      event("neurofront:accountrecords", { owner: null }); return
    }
    const cached = await readCache(next.id)
    if (!current(next.id, generation)) return
    bucket = cached
    applyPreferences(); event("neurofront:accountrecords", { owner: next.id }); emit()
    await refresh()
    if (!current(next.id, generation)) return
    try { const data = await guestData(); if (current(next.id, generation)) { guestAvailable = Boolean(data.baseline || data.captures.length); emit() } } catch {}
  }
  function requireAuthReady() {
    if (!configured || !client) throw fail("configuration")
    if (busy()) throw fail("activeCapture")
  }
  function authError(value) {
    if (!value) return
    const code = value.code === "invalid_credentials" ? "credentials" : value.code === "email_not_confirmed" ? "verification" : value.code === "weak_password" ? "password" : "authentication"
    throw fail(code)
  }
  async function signIn(email, password) {
    requireAuthReady()
    const result = await client.auth.signInWithPassword({ email, password }); authError(result.error)
    await changeSession(result.data.session)
  }
  async function signUp(email, password, displayName) {
    requireAuthReady()
    const result = await client.auth.signUp({ email, password, options: { data: { display_name: displayName || "" }, emailRedirectTo: location.origin + "/#account" } })
    authError(result.error)
    if (result.data.session) await changeSession(result.data.session)
    return { verificationRequired: !result.data.session }
  }
  async function recover(email) {
    requireAuthReady()
    const result = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/#account-recovery" }); authError(result.error)
  }
  async function updatePassword(password) {
    requireAuthReady()
    const result = await client.auth.updateUser({ password }); authError(result.error)
  }
  async function signOut() {
    requireAuthReady()
    const result = await client.auth.signOut({ scope: "local" }); authError(result.error)
    await changeSession(null)
  }
  async function uploadAvatar(file) {
    requireAuthReady()
    const id = owner(), generation = epoch
    if (!id || !file || !["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) throw fail("avatar")
    const image = await createImageBitmap(file)
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 256
    const side = Math.min(image.width, image.height)
    canvas.getContext("2d").drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 256, 256); image.close()
    const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/webp", 0.85))
    if (!current(id, generation) || !blob) throw fail("authentication")
    const path = `${id}/${uid()}.webp`
    await cloud(`/storage/v1/object/nf-avatars/${path}`, { method: "POST", body: blob, headers: { "Content-Type": "image/webp", "x-upsert": "false" } }, id)
    if (!current(id, generation)) return
    await updateProfile({ avatar_path: path }); await flush(); await loadAvatar(id, generation); emit()
  }
  function selectThread(id) {
    const thread = bucket?.threads.find(row => row.id === id)
    if (thread) event("neurofront:threadselect", { thread: clone(thread), captures: clone(bucket.captures) })
  }
  async function initialize() {
    if (initialized) return
    initialized = true
    try {
      const response = await fetch("/api/account-config", { signal: AbortSignal.timeout(10000) })
      config = await response.json()
      if (!response.ok || !config.configured) { configured = false; emit(); return }
      if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(config.url) || typeof config.publishableKey !== "string") throw fail("configuration")
      await new Promise((resolve, reject) => {
        const script = document.createElement("script")
        script.src = "supabase-2.118.0.js"; script.onload = resolve; script.onerror = reject
        document.head.append(script)
      })
      client = window.supabase.createClient(config.url, config.publishableKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: "pkce", storageKey: "neurofront.auth" } })
      configured = true
      const callback = location.hash.includes("account") || location.search.includes("code=") || location.hash.includes("error=")
      let callbackHandled = false
      client.auth.onAuthStateChange((type, session) => {
        setTimeout(async () => {
          await changeSession(session)
          if (type === "PASSWORD_RECOVERY") { callbackHandled = true; event("neurofront:accountrecovery", {}) }
          else if (callback && !callbackHandled && ["SIGNED_IN", "INITIAL_SESSION"].includes(type)) {
            callbackHandled = true
            event(session?.user ? "neurofront:accountverification" : "neurofront:accountcallbackerror", {})
          }
        }, 0)
      })
      const result = await client.auth.getSession()
      if (result.error) throw fail("authentication")
      await changeSession(result.data.session)
    } catch (e) { error = e.code || "configuration"; emit() }
  }
  document.addEventListener("neurofront:languagechange", () => {
    if (!applying && user && bucket?.profile) updateProfile({ preferences: { language: document.documentElement.lang } }).catch(e => { error = e.code; emit() })
  })
  document.addEventListener("neurofront:resourcespreference", event => {
    if (!applying && user && bucket?.profile) updateProfile({ preferences: { resourcesExpanded: event.detail.expanded } }).catch(e => { error = e.code; emit() })
  })
  document.addEventListener("neurofront:devicebusy", emit)
  window.addEventListener("online", () => { if (owner()) { error = ""; flush().then(() => refresh()) } })
  window.addEventListener("focus", () => { if (owner() && Date.now() - lastReload > 45000 && !bucket?.outbox.length) refresh() })
  window.NeuroFrontAccount = Object.freeze({ getState: snapshot, owner, isCurrent: id => owner() === id, accessToken, deviceBusy: emit,
    signIn, signUp, recover, updatePassword, signOut, updateProfile, setActiveBaseline, uploadAvatar,
    saveBaseline, saveCapture, saveThread, importGuest, selectThread, reload: () => refresh(true),
    retry: async () => { if (conflict) throw fail("conflict"); error = ""; await flush(); if (!bucket?.outbox.length) await refresh() },
    captureSaved: id => Boolean(bucket?.captures.find(record => record.id === id)?.cloudSaved) })
  initialize()
})()
