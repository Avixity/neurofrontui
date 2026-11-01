(() => {
  "use strict"
  const button = document.getElementById("accountButton")
  if (!button) return
  const dialog = document.createElement("dialog")
  dialog.id = "accountDialog"
  dialog.className = "content-dialog account-dialog"
  dialog.setAttribute("aria-labelledby", "accountTitle")
  dialog.innerHTML = `
    <div class="setup-dialog-head account-dialog-head">
      <h2 id="accountTitle" data-account-text="account.title"></h2>
      <button class="setup-dialog-close action-button ghost" id="accountClose" type="button" data-account-label="common.close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button>
    </div>
    <p class="account-notice" id="accountConfiguration" data-account-text="account.configuration" hidden></p>
    <p class="account-notice" id="accountBusy" data-account-text="account.busy" hidden></p>
    <div id="accountAuth">
      <div class="account-tabs" id="accountTabs" role="group" data-account-label="account.authentication">
        <button class="action-button ghost" id="accountSignInTab" type="button" data-account-text="account.signIn" aria-pressed="true"></button>
        <button class="action-button ghost" id="accountSignUpTab" type="button" data-account-text="account.signUp" aria-pressed="false"></button>
      </div>
      <p class="account-helper" id="accountAuthHelp"></p>
      <form id="accountAuthForm" class="account-form" novalidate>
        <label id="accountNameField" hidden><span data-account-text="account.displayNameOptional"></span><input id="accountSignupName" type="text" maxlength="80" autocomplete="nickname"></label>
        <label id="accountEmailField"><span data-account-text="account.email"></span><input id="accountEmail" type="email" inputmode="email" autocomplete="email" maxlength="254" required></label>
        <label id="accountPasswordField"><span data-account-text="account.password"></span><span class="account-password-field"><input id="accountPassword" type="password" autocomplete="current-password" maxlength="128" required><button class="account-password-toggle" type="button" data-password-target="accountPassword" aria-pressed="false"></button></span></label>
        <label id="accountConfirmField" hidden><span data-account-text="account.confirmPassword"></span><span class="account-password-field"><input id="accountConfirm" type="password" autocomplete="new-password" maxlength="128"><button class="account-password-toggle" type="button" data-password-target="accountConfirm" aria-pressed="false"></button></span></label>
        <p class="account-helper" id="accountPasswordHelp" data-account-text="account.passwordHelp" hidden></p>
        <button class="action-button accent" id="accountSubmit" type="submit"></button>
      </form>
      <div class="account-auth-links">
        <button class="text-button" id="accountForgot" type="button" data-account-text="account.forgot"></button>
        <button class="text-button" id="accountBack" type="button" data-account-text="account.back" hidden></button>
        <button class="text-button" id="accountGuest" type="button" data-account-text="account.guest"></button>
      </div>
    </div>
    <div id="accountProfile" hidden>
      <div class="account-identity">
        <span class="account-profile-avatar"><span id="accountProfileInitials" aria-hidden="true"></span><img id="accountProfileAvatar" alt="" hidden></span>
        <div class="account-identity-details"><strong id="accountProfileName"></strong><p id="accountProfileEmail"></p><button class="text-button account-upload-label" id="accountChooseAvatar" type="button" data-account-text="account.changePhoto"></button><input id="accountAvatarFile" type="file" accept="image/jpeg,image/png,image/webp" hidden><p class="account-helper" data-account-text="account.photoHelp"></p></div>
      </div>
      <div class="account-form account-preferences">
        <label><span data-account-text="account.displayName"></span><input id="accountDisplayName" type="text" maxlength="80" autocomplete="nickname"></label>
        <label><span data-account-text="language"></span><select id="accountLanguage"></select></label>
        <label class="account-checkbox"><input id="accountResources" type="checkbox"><span data-account-text="account.expandResources"></span></label>
        <p class="account-helper" data-account-text="account.autoSave"></p>
      </div>
      <section class="account-section">
        <h3 data-account-text="account.baselines"></h3>
        <label class="account-form"><span class="account-helper" data-account-text="account.activeBaseline"></span><select id="accountBaseline"></select></label>
        <p class="account-helper" data-account-text="account.baselineHelp"></p>
      </section>
      <section class="account-section account-cloud-section">
        <h3 data-account-text="account.cloudData"></h3>
        <p class="account-helper" id="accountRecordCounts"></p>
        <div class="account-save-row"><p id="accountCloudStatus" role="status"></p><button class="text-button" id="accountRetry" type="button" data-account-text="history.retry" hidden></button></div>
        <p class="account-notice" id="accountConflict" data-account-text="account.conflict" hidden></p>
        <button class="action-button ghost" id="accountReload" type="button" data-account-text="account.reload" hidden></button>
        <details class="account-threads" id="accountThreads"><summary data-account-text="account.conversations"></summary><ul id="accountThreadList"></ul></details>
      </section>
      <section class="account-section" id="accountGuestImport" hidden>
        <h3 data-account-text="account.guestData"></h3><p class="account-helper" data-account-text="account.importHelp"></p>
        <button class="action-button ghost account-import-button" id="accountImport" type="button" data-account-text="account.importGuest"></button>
      </section>
      <button class="action-button ghost account-signout" id="accountSignOut" type="button" data-account-text="account.signOut"></button>
    </div>
    <p class="account-feedback" id="accountFeedback" role="status" hidden></p>
    <p class="account-error" id="accountError" role="alert" hidden></p>`
  document.body.append(dialog)
  const byId = id => document.getElementById(id)
  const api = () => window.NeuroFrontAccount
  const state = () => api()?.getState() || { configured: false, user: null, baselines: [], captures: [], threads: [] }
  const locale = () => document.documentElement.lang || "en"
  const text = (key, values = {}) => {
    const dictionaries = window.NEUROFRONT_TRANSLATIONS || {}
    return (dictionaries[locale()]?.[key] || dictionaries.en?.[key] || key).replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match)
  }
  const languages = [["en", "English"], ["hi", "हिन्दी"], ["mr", "मराठी"], ["bn", "বাংলা"], ["ta", "தமிழ்"], ["te", "తెలుగు"], ["kn", "ಕನ್ನಡ"], ["ml", "മലയാളം"], ["gu", "ગુજરાતી"], ["pa", "ਪੰਜਾਬੀ"], ["or", "ଓଡ଼ିଆ"], ["as", "অসমীয়া"], ["ur", "اردو"]]
  for (const [value, label] of languages) byId("accountLanguage").add(new Option(label, value))
  let mode = "signin"
  let working = false
  let feedbackKey = ""
  let errorKey = ""
  let opener = button
  let operation = 0
  let renderedUser = null
  let lastThreadSignature = ""
  let lastBaselineSignature = ""

  function errorCode(error) {
    const code = String(error?.code || error?.message || "generic").replace(/^account\.error\./, "")
    const codes = {
      invalid_credentials: "credentials", invalid_login_credentials: "credentials", credentials: "credentials",
      email_not_confirmed: "verification", verification: "verification", configuration: "configuration", not_configured: "configuration",
      conflict: "conflict", active_capture: "activeCapture", activeCapture: "activeCapture", busy: "activeCapture",
      weak_password: "password", password: "password", password_mismatch: "match", match: "match",
      invalid_email: "email", email: "email", user_already_exists: "exists", email_exists: "exists",
      over_email_send_rate_limit: "rate", over_request_rate_limit: "rate", rate: "rate", rate_limit: "rate",
      avatar: "avatar", invalid_avatar: "avatar", network: "network", offline: "network", storage: "storage",
      session_expired: "session", session: "session", recovery: "recovery", not_authenticated: "session"
    }
    return `account.error.${codes[code] || "generic"}`
  }
  function feedback(key = "", isError = false) {
    if (isError) { errorKey = key; feedbackKey = "" }
    else { feedbackKey = key; errorKey = "" }
    renderFeedback()
  }
  function renderFeedback() {
    byId("accountError").hidden = !errorKey
    byId("accountError").textContent = errorKey ? text(errorKey) : ""
    byId("accountFeedback").hidden = !feedbackKey
    byId("accountFeedback").textContent = feedbackKey ? text(feedbackKey) : ""
  }
  function setMode(next) {
    mode = next
    feedback()
    byId("accountPassword").value = ""
    byId("accountConfirm").value = ""
    render()
    byId(next === "reset" ? "accountPassword" : "accountEmail").focus({ preventScroll: true })
  }
  function formatDate(value) {
    const date = new Date(value)
    return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(date) : text("account.dateUnknown")
  }
  function initials(value) {
    const parts = String(value || "").trim().split(/\s+/u).filter(Boolean)
    return parts.slice(0, 2).map(word => [...word][0] || "").join("").toLocaleUpperCase(locale()) || "N"
  }
  function avatar(image, fallback, url) {
    let safe = false
    try { const parsed = new URL(url); safe = parsed.protocol === "https:" || (parsed.protocol === "http:" && ["localhost", "127.0.0.1"].includes(parsed.hostname)) } catch {}
    image.hidden = !safe
    fallback.hidden = safe
    if (safe) {
      if (image.src !== url) image.src = url
    } else image.removeAttribute("src")
  }
  function render() {
    const current = state()
    const user = current.user
    const profile = current.profile || {}
    const locked = working || current.loading || current.busy
    const pending = Array.isArray(current.pending) ? current.pending.length : Number(current.pending || 0)
    const privateView = Boolean(user) && mode !== "reset"
    if (renderedUser !== (user?.id || null)) {
      renderedUser = user?.id || null
      lastThreadSignature = ""
      lastBaselineSignature = ""
      if (mode !== "reset") mode = "signin"
      byId("accountDisplayName").value = profile.display_name || ""
    }
    dialog.dir = locale() === "ur" ? "rtl" : "ltr"
    dialog.querySelectorAll("[data-account-text]").forEach(element => { element.textContent = text(element.dataset.accountText) })
    dialog.querySelectorAll("[data-account-label]").forEach(element => element.setAttribute("aria-label", text(element.dataset.accountLabel)))
    button.setAttribute("aria-label", text(user ? "account.profile" : "account.title"))
    byId("accountTitle").textContent = text(mode === "reset" ? "account.newPassword" : privateView ? "account.profile" : mode === "recover" ? "account.forgot" : "account.title")
    byId("accountGuestIcon").toggleAttribute("hidden", Boolean(user))
    byId("accountInitials").hidden = !user
    byId("accountHeaderAvatar").hidden = !user
    byId("accountPendingDot").hidden = !(user && (pending || current.error || current.conflict))
    byId("accountInitials").textContent = initials(profile.display_name || user?.email)
    if (user) avatar(byId("accountHeaderAvatar"), byId("accountInitials"), profile.avatarUrl)
    else byId("accountHeaderAvatar").removeAttribute("src")
    byId("accountConfiguration").hidden = current.configured !== false
    byId("accountBusy").hidden = !current.busy
    byId("accountAuth").hidden = privateView
    byId("accountProfile").hidden = !privateView
    byId("accountTabs").hidden = ["recover", "reset"].includes(mode)
    byId("accountSignInTab").setAttribute("aria-pressed", String(mode === "signin"))
    byId("accountSignUpTab").setAttribute("aria-pressed", String(mode === "signup"))
    byId("accountNameField").hidden = mode !== "signup"
    byId("accountEmailField").hidden = mode === "reset"
    byId("accountPasswordField").hidden = mode === "recover"
    byId("accountConfirmField").hidden = !["signup", "reset"].includes(mode)
    byId("accountPasswordHelp").hidden = !["signup", "reset"].includes(mode)
    byId("accountForgot").hidden = mode !== "signin"
    byId("accountBack").hidden = mode !== "recover"
    byId("accountPassword").autocomplete = mode === "signin" ? "current-password" : "new-password"
    byId("accountAuthHelp").textContent = text(mode === "signup" ? "account.signupHelp" : mode === "recover" ? "account.recoverHelp" : mode === "reset" ? "account.resetHelp" : "account.signinHelp")
    byId("accountSubmit").textContent = text(working ? "account.working" : mode === "signup" ? "account.signUp" : mode === "recover" ? "account.sendRecovery" : mode === "reset" ? "account.updatePassword" : "account.signIn")
    for (const element of dialog.querySelectorAll("input, select, button")) {
      if (["accountClose", "accountGuest"].includes(element.id)) continue
      element.disabled = Boolean(locked || current.configured === false)
    }
    dialog.querySelectorAll("[data-password-target]").forEach(toggle => {
      const visible = byId(toggle.dataset.passwordTarget).type === "text"
      toggle.textContent = text(visible ? "account.hidePassword" : "account.showPassword")
      toggle.setAttribute("aria-pressed", String(visible))
      toggle.setAttribute("aria-label", `${text("account.password")}: ${toggle.textContent}`)
    })
    if (user) {
      byId("accountProfileName").textContent = profile.display_name || text("account.profile")
      byId("accountProfileEmail").textContent = user.email || ""
      byId("accountProfileInitials").textContent = initials(profile.display_name || user.email)
      avatar(byId("accountProfileAvatar"), byId("accountProfileInitials"), profile.avatarUrl)
      if (document.activeElement !== byId("accountDisplayName")) byId("accountDisplayName").value = profile.display_name || ""
      byId("accountLanguage").value = profile.preferences?.language || locale()
      byId("accountResources").checked = Boolean(profile.preferences?.resourcesExpanded)
      const baselines = current.baselines || []
      const baselineSignature = JSON.stringify([locale(), profile.active_baseline_id, baselines.map(item => [item.id, item.payload?.createdAt, item.created_at])])
      if (lastBaselineSignature !== baselineSignature) {
        lastBaselineSignature = baselineSignature
        byId("accountBaseline").replaceChildren(new Option(text("account.noBaseline"), ""))
        for (const baseline of baselines) byId("accountBaseline").add(new Option(formatDate(baseline.payload?.createdAt || baseline.payload?.calibratedAt || baseline.created_at), baseline.id))
        byId("accountBaseline").value = profile.active_baseline_id || ""
      }
      byId("accountBaseline").disabled = Boolean(locked || !baselines.length || current.conflict)
      byId("accountRecordCounts").textContent = text("account.recordCounts", { baselines: baselines.length, captures: (current.captures || []).length })
      const saveKey = current.conflict ? "account.conflictShort" : current.error ? "account.saveError" : current.loading || !current.profile ? "account.loading" : pending ? "account.pending" : current.status === "saved" || current.status === "ready" ? "account.saved" : "account.syncReady"
      byId("accountCloudStatus").textContent = text(saveKey, { count: pending })
      byId("accountRetry").hidden = !(pending || current.error) || Boolean(current.conflict)
      byId("accountConflict").hidden = !current.conflict
      byId("accountReload").hidden = !current.conflict
      byId("accountGuestImport").hidden = !current.guestAvailable
      const threads = current.threads || []
      const signature = JSON.stringify([locale(), threads.map(thread => [thread.id, thread.updated_at, thread.title])])
      if (lastThreadSignature !== signature) {
        lastThreadSignature = signature
        const list = byId("accountThreadList")
        list.replaceChildren()
        if (!threads.length) {
          const empty = document.createElement("li")
          empty.className = "account-helper"
          empty.textContent = text("account.noConversations")
          list.append(empty)
        }
        for (const thread of threads) {
          const item = document.createElement("li")
          const control = document.createElement("button")
          control.type = "button"
          control.className = "account-thread-button"
          control.dataset.threadId = thread.id
          control.textContent = thread.title || text("account.conversationDate", { date: formatDate(thread.updated_at || thread.created_at) })
          control.disabled = Boolean(locked)
          item.append(control)
          list.append(item)
        }
      }
    } else {
      byId("accountProfileName").textContent = ""
      byId("accountProfileEmail").textContent = ""
      byId("accountProfileInitials").textContent = ""
      byId("accountProfileAvatar").removeAttribute("src")
      byId("accountThreadList").replaceChildren()
      byId("accountBaseline").replaceChildren()
    }
    renderFeedback()
  }
  async function run(task, successKey) {
    if (working) return
    if (state().busy) { feedback("account.error.activeCapture", true); return }
    const id = ++operation
    working = true
    feedback()
    render()
    try {
      if (!api() || state().configured === false) throw { code: "configuration" }
      const result = await task()
      if (id !== operation) return
      if (result?.error) throw result.error
      if (successKey) feedback(successKey)
    } catch (error) {
      if (id === operation) feedback(errorCode(error), true)
    } finally {
      if (id === operation) { working = false; render() }
    }
  }
  function open(nextMode) {
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : button
    if (nextMode) mode = nextMode
    render()
    if (!dialog.open) dialog.showModal()
    byId("accountClose").focus({ preventScroll: true })
  }
  function close() { dialog.close() }
  button.addEventListener("click", () => open())
  byId("accountClose").addEventListener("click", close)
  byId("accountGuest").addEventListener("click", close)
  dialog.addEventListener("close", () => {
    byId("accountPassword").value = ""
    byId("accountConfirm").value = ""
    byId("accountPassword").type = "password"
    byId("accountConfirm").type = "password"
    if (opener?.isConnected) opener.focus({ preventScroll: true })
  })
  dialog.addEventListener("keydown", event => {
    if (event.key !== "Tab") return
    const controls = [...dialog.querySelectorAll('button, input, select, textarea, summary, a[href], [tabindex="0"]')]
      .filter(element => !element.disabled && element.getClientRects().length)
    const first = controls[0], last = controls.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  })
  dialog.addEventListener("click", event => {
    if (event.target === dialog) {
      const rect = dialog.getBoundingClientRect()
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) close()
    }
  })
  byId("accountSignInTab").addEventListener("click", () => setMode("signin"))
  byId("accountSignUpTab").addEventListener("click", () => setMode("signup"))
  byId("accountForgot").addEventListener("click", () => setMode("recover"))
  byId("accountBack").addEventListener("click", () => setMode("signin"))
  dialog.querySelectorAll("[data-password-target]").forEach(toggle => toggle.addEventListener("click", () => {
    const input = byId(toggle.dataset.passwordTarget)
    input.type = input.type === "password" ? "text" : "password"
    render()
  }))
  byId("accountAuthForm").addEventListener("submit", event => {
    event.preventDefault()
    if (working) return
    const email = byId("accountEmail").value.trim()
    const password = byId("accountPassword").value
    if (mode !== "reset" && (!email || !byId("accountEmail").validity.valid)) { feedback("account.error.email", true); byId("accountEmail").focus(); return }
    if (mode !== "recover" && (!password || (["signup", "reset"].includes(mode) && password.length < 8))) { feedback("account.error.password", true); byId("accountPassword").focus(); return }
    if (["signup", "reset"].includes(mode) && password !== byId("accountConfirm").value) { feedback("account.error.match", true); byId("accountConfirm").focus(); return }
    const actionMode = mode
    run(async () => {
      if (actionMode === "signin") await api().signIn(email, password)
      else if (actionMode === "signup") {
        await api().signUp(email, password, byId("accountSignupName").value.trim())
        if (!state().user) { mode = "signin"; feedback("account.verificationSent") }
      } else if (actionMode === "recover") { await api().recover(email); feedback("account.recoverySent") }
      else { await api().updatePassword(password); mode = "signin"; feedback("account.passwordUpdated") }
      byId("accountPassword").value = ""
      byId("accountConfirm").value = ""
    })
  })
  byId("accountSignOut").addEventListener("click", () => run(async () => { await api().signOut(); mode = "signin" }))
  byId("accountDisplayName").addEventListener("change", event => {
    const value = event.target.value.trim()
    if (value !== (state().profile?.display_name || "")) run(() => api().updateProfile({ display_name: value }))
  })
  byId("accountLanguage").addEventListener("change", event => {
    const language = event.target.value
    run(() => api().updateProfile({ preferences: { language } }))
  })
  byId("accountResources").addEventListener("change", event => {
    const resourcesExpanded = event.target.checked
    run(() => api().updateProfile({ preferences: { resourcesExpanded } }))
  })
  byId("accountBaseline").addEventListener("change", event => {
    const id = event.target.value
    if (id) run(() => api().setActiveBaseline(id))
    else render()
  })
  byId("accountImport").addEventListener("click", () => run(() => api().importGuest()))
  byId("accountRetry").addEventListener("click", () => run(() => api().retry()))
  byId("accountReload").addEventListener("click", () => run(() => api().reload()))
  byId("accountChooseAvatar").addEventListener("click", () => byId("accountAvatarFile").click())
  byId("accountAvatarFile").addEventListener("change", event => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2 * 1024 * 1024) feedback("account.error.avatar", true)
    else run(() => api().uploadAvatar(file))
    event.target.value = ""
  })
  byId("accountThreadList").addEventListener("click", event => {
    const target = event.target.closest("[data-thread-id]")
    if (!target || target.disabled) return
    run(async () => {
      if (api().selectThread) await api().selectThread(target.dataset.threadId)
      else document.dispatchEvent(new CustomEvent("neurofront:accountthread", { detail: { id: target.dataset.threadId } }))
      close()
    })
  })
  for (const id of ["accountHeaderAvatar", "accountProfileAvatar"]) byId(id).addEventListener("error", () => {
    byId(id).hidden = true
    byId(id === "accountHeaderAvatar" ? "accountInitials" : "accountProfileInitials").hidden = false
  })
  document.addEventListener("neurofront:accountchange", render)
  document.addEventListener("neurofront:languagechange", render)
  document.addEventListener("neurofront:accountrecovery", () => { feedback(); open("reset") })
  document.addEventListener("neurofront:accountverification", () => { feedback("account.verified"); open() })
  document.addEventListener("neurofront:accountcallbackerror", () => { mode = "signin"; feedback("account.error.recovery", true); open() })
  window.NeuroFrontAccountUI = Object.freeze({ open, close })
  render()
})()
