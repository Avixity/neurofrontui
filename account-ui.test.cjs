"use strict"
const assert = require("node:assert/strict")
const fs = require("node:fs")
const path = require("node:path")
const vm = require("node:vm")
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright")
const url = process.env.NEUROFRONT_URL || "http://127.0.0.1:5183"
const screenshotDir = process.env.NEUROFRONT_SCREENSHOT_DIR
const translationContext = { window: {} }
vm.runInNewContext(fs.readFileSync("account-language.js", "utf8"), translationContext)
const dictionaries = translationContext.window.NEUROFRONT_TRANSLATIONS
const keys = Object.keys(dictionaries.en)
assert.equal(Object.keys(dictionaries).length, 13)
for (const [locale, dictionary] of Object.entries(dictionaries)) {
  assert.deepEqual(Object.keys(dictionary), keys, locale)
  for (const key of keys) {
    assert.ok(dictionary[key] && !dictionary[key].includes("\u2014"), `${locale}:${key}`)
    assert.deepEqual((dictionary[key].match(/\{\w+\}/g) || []).sort(), (dictionaries.en[key].match(/\{\w+\}/g) || []).sort(), `${locale}:${key}`)
  }
}

const mock = `(() => {
 const calls = [], base = { id: 'baseline-1', payload: { createdAt: '2026-10-30T10:00:00Z' } };
 const state = { user:null,profile:null,baselines:[],captures:[],threads:[],configured:true,loading:false,pending:0,error:'',conflict:false,guestAvailable:true,busy:false,status:'guest' };
 const emit = () => document.dispatchEvent(new Event('neurofront:accountchange'));
 const fail = code => { const error = new Error(code); error.code=code; throw error; };
 const apply = patch => { Object.assign(state,patch); emit(); };
 window.accountMock={state,calls,apply};
 window.NeuroFrontAccount={getState:()=>structuredClone(state),owner:()=>state.user?.id||null,isCurrent:id=>id===(state.user?.id||null),deviceBusy:()=>{},
 async signIn(email,password){calls.push(['signIn',email]); if(password==='wrong-password')fail('credentials'); apply({user:{id:'account-a',email},profile:{display_name:'Aarya',preferences:{language:'en',resourcesExpanded:false},active_baseline_id:base.id},baselines:[base],captures:[{id:'capture-1'}],threads:[{id:'thread-1',title:'My capture',updated_at:'2026-10-31T10:00:00Z'}],status:'saved'});},
 async signUp(email,password,displayName){calls.push(['signUp',email,displayName]); return {verificationRequired:true};},
 async recover(email){calls.push(['recover',email]);},async updatePassword(){calls.push(['updatePassword']);},
 async signOut(){calls.push(['signOut']);apply({user:null,profile:null,baselines:[],captures:[],threads:[],status:'guest'});},
 async updateProfile(patch){calls.push(['profile',patch]);state.profile={...state.profile,...patch,preferences:{...state.profile.preferences,...patch.preferences}};if(patch.preferences?.language){document.documentElement.lang=patch.preferences.language;document.dispatchEvent(new Event('neurofront:languagechange'));}emit();},
 async setActiveBaseline(id){calls.push(['baseline',id]);state.profile.active_baseline_id=id;emit();},
 async importGuest(){calls.push(['import']);apply({guestAvailable:false});},async retry(){calls.push(['retry']);apply({error:'',pending:0,status:'saved'});},async reload(){calls.push(['reload']);apply({conflict:false,error:''});},
 async uploadAvatar(file){calls.push(['avatar',file.type,file.size]);},selectThread(id){calls.push(['thread',id]);}
 };
})();`

let browser
;(async () => {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined })
  const context = await browser.newContext({ viewport: { width: 1366, height: 768 } })
  const page = await context.newPage()
  page.setDefaultTimeout(20000)
  const errors = []
  page.on("pageerror", error => errors.push(error.message))
  await page.route("**/account-store.js", route => route.fulfill({ contentType: "application/javascript", body: mock }))
  await page.goto(url)
  await page.waitForFunction(() => window.NeuroFrontAccountUI && document.body.classList.contains("is-ready"))
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "neurofront-account-guest-desktop.png") })
  assert.equal(await page.locator("#accountDialog").isVisible(), false, "Guest dashboard opens without forced popup")
  const placement = await page.evaluate(() => {
    const account = document.getElementById("accountButton").getBoundingClientRect()
    const status = document.getElementById("statusPill").getBoundingClientRect()
    return { x: account.x, statusRight: status.right, center: account.y + account.height / 2, statusCenter: status.y + status.height / 2 }
  })
  assert.ok(placement.x > placement.statusRight && placement.x - placement.statusRight < 20)
  assert.ok(Math.abs(placement.center - placement.statusCenter) < 2)
  await page.locator("#accountButton").click()
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "neurofront-account-signin-desktop.png") })
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab")
    assert.equal(await page.evaluate(() => document.getElementById("accountDialog").contains(document.activeElement)), true)
  }
  await page.locator("#accountGuest").click()
  assert.equal(await page.evaluate(() => document.activeElement.id), "accountButton")
  await page.locator("#accountButton").click()
  await page.locator("#accountSignUpTab").click()
  await page.locator("#accountEmail").fill("invalid")
  await page.locator("#accountSubmit").click()
  assert.equal(await page.locator("#accountError").textContent(), dictionaries.en["account.error.email"])
  await page.locator("#accountEmail").fill("synthetic@example.test")
  await page.locator("#accountPassword").fill("long-password")
  await page.locator("#accountConfirm").fill("other-password")
  await page.locator("#accountSubmit").click()
  assert.equal(await page.locator("#accountError").textContent(), dictionaries.en["account.error.match"])
  await page.locator('[data-password-target="accountPassword"]').click()
  assert.equal(await page.locator("#accountPassword").getAttribute("type"), "text")
  await page.locator("#accountConfirm").fill("long-password")
  await page.locator("#accountSignupName").fill("Synthetic user")
  await page.locator("#accountSubmit").click()
  await page.waitForFunction(() => accountMock.calls.some(call => call[0] === "signUp"))
  assert.equal(await page.locator("#accountFeedback").textContent(), dictionaries.en["account.verificationSent"])
  assert.equal(await page.locator("#accountPassword").inputValue(), "")
  assert.equal(await page.evaluate(() => accountMock.state.user), null)
  await page.locator("#accountPassword").fill("wrong-password")
  await page.locator("#accountSubmit").click()
  await page.waitForFunction(() => !document.getElementById("accountError").hidden)
  await page.waitForTimeout(5100)
  assert.equal(await page.locator("#accountError").textContent(), dictionaries.en["account.error.credentials"], "Account errors are not ephemeral")
  await page.locator("#accountForgot").click()
  await page.locator("#accountSubmit").click()
  await page.waitForFunction(() => accountMock.calls.some(call => call[0] === "recover"))
  assert.equal(await page.locator("#accountFeedback").textContent(), dictionaries.en["account.recoverySent"])
  await page.keyboard.press("Escape")
  await page.evaluate(() => document.dispatchEvent(new Event("neurofront:accountrecovery")))
  assert.equal(await page.locator("#accountDialog").isVisible(), true)
  assert.equal(await page.locator("#accountEmailField").isVisible(), false)
  await page.locator("#accountPassword").fill("new-long-password")
  await page.locator("#accountConfirm").fill("new-long-password")
  await page.locator("#accountSubmit").click()
  await page.waitForFunction(() => accountMock.calls.some(call => call[0] === "updatePassword"))
  assert.equal(await page.locator("#accountFeedback").textContent(), dictionaries.en["account.passwordUpdated"])
  await page.locator("#accountPassword").fill("correct-password")
  await page.locator("#accountSubmit").click()
  await page.waitForFunction(() => !document.getElementById("accountProfile").hidden)
  assert.equal(await page.locator("#accountInitials").textContent(), "A")
  assert.equal(await page.locator("#accountGuestIcon").isVisible(), false)
  assert.equal(await page.locator("#accountBaseline").inputValue(), "baseline-1")
  assert.equal(await page.locator("#accountCloudStatus").textContent(), dictionaries.en["account.saved"])
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "neurofront-account-profile-desktop.png") })
  assert.equal(await page.evaluate(() => accountMock.calls.some(call => call[0] === "import")), false)
  await page.locator("#accountImport").click()
  await page.waitForFunction(() => document.getElementById("accountGuestImport").hidden)
  assert.equal(await page.evaluate(() => accountMock.calls.filter(call => call[0] === "import").length), 1)
  await page.locator("#accountDisplayName").fill("<img src=x onerror=alert(1)>")
  await page.locator("#accountResources").focus()
  await page.waitForFunction(() => accountMock.calls.some(call => call[0] === "profile"))
  assert.equal(await page.locator("#accountProfileName img").count(), 0)
  await page.locator("#accountDisplayName").fill("Aarya")
  await page.locator("#accountResources").focus()
  await page.waitForFunction(() => accountMock.state.profile.display_name === "Aarya")
  await page.locator("#accountResources").check()
  assert.equal(await page.evaluate(() => accountMock.state.profile.preferences.resourcesExpanded), true)
  await page.evaluate(() => accountMock.apply({ error: "sync", pending: 2 }))
  assert.equal(await page.locator("#accountCloudStatus").textContent(), dictionaries.en["account.saveError"])
  await page.locator("#accountRetry").click()
  await page.waitForFunction(() => accountMock.state.pending === 0)
  await page.evaluate(() => accountMock.apply({ conflict: true }))
  assert.equal(await page.locator("#accountConflict").isVisible(), true)
  await page.locator("#accountReload").click()
  await page.waitForFunction(() => !accountMock.state.conflict)
  await page.evaluate(() => accountMock.apply({ busy: true }))
  assert.equal(await page.locator("#accountSignOut").isDisabled(), true)
  assert.equal(await page.locator("#accountBusy").isVisible(), true)
  await page.evaluate(() => accountMock.apply({ busy: false }))
  for (const lang of Object.keys(dictionaries)) {
    await page.locator("#accountLanguage").selectOption(lang)
    await page.waitForFunction(code => document.documentElement.lang === code, lang)
    assert.equal(await page.locator("#accountSignOut").textContent(), dictionaries[lang]["account.signOut"])
    assert.equal(await page.locator("#accountDialog").getAttribute("dir"), lang === "ur" ? "rtl" : "ltr")
    const missing = await page.locator("#accountDialog").evaluate(element => element.textContent.match(/account\.[a-zA-Z]+/g))
    assert.equal(missing, null)
  }
  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 740 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport)
    const metrics = await page.evaluate(() => {
      const d = document.getElementById("accountDialog")
      return { page: document.documentElement.scrollWidth, width: innerWidth, dialog: d.scrollWidth, client: d.clientWidth, top: d.getBoundingClientRect().top, bottom: d.getBoundingClientRect().bottom, height: innerHeight }
    })
    assert.ok(metrics.page <= metrics.width + 1, JSON.stringify(metrics))
    assert.ok(metrics.dialog <= metrics.client + 1, JSON.stringify(metrics))
    assert.ok(metrics.top >= 0 && metrics.bottom <= metrics.height + 1, JSON.stringify(metrics))
    if (screenshotDir && viewport.width === 390) {
      await page.locator("#accountDialog").evaluate(element => { element.scrollTop = 0 })
      await page.screenshot({ path: path.join(screenshotDir, "neurofront-account-profile-urdu-mobile.png") })
    }
  }
  await page.locator("#accountLanguage").selectOption("en")
  await page.locator("#accountThreads summary").click()
  await page.locator('[data-thread-id="thread-1"]').click()
  assert.equal(await page.locator("#accountDialog").isVisible(), false)
  assert.equal(await page.evaluate(() => accountMock.calls.some(call => call[0] === "thread" && call[1] === "thread-1")), true)
  await page.locator("#accountButton").click()
  await page.locator("#accountSignOut").click()
  await page.waitForFunction(() => document.getElementById("accountProfile").hidden)
  assert.equal(await page.locator("#accountGuestIcon").isVisible(), true)
  await page.evaluate(() => accountMock.apply({ configured: false }))
  assert.equal(await page.locator("#accountConfiguration").isVisible(), true)
  assert.equal(await page.locator("#accountSubmit").isDisabled(), true)
  assert.equal(await page.locator("#accountGuest").isEnabled(), true)
  await page.locator("#accountGuest").click()
  await page.evaluate(() => document.dispatchEvent(new Event("neurofront:accountcallbackerror")))
  assert.equal(await page.locator("#accountDialog").isVisible(), true)
  assert.equal(await page.locator("#accountError").textContent(), dictionaries.en["account.error.recovery"])
  assert.deepEqual(errors, [])
  await browser.close()
  console.log(JSON.stringify({ passed: true, translations: 13, keys: keys.length, authentication: "simulated provider only", desktop: "1366x768", mobile: ["390x844", "320x740", "844x390"], errors }))
})().catch(async error => { console.error(error); await browser?.close(); process.exitCode = 1 })
