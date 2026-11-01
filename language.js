(() => {
  const dictionaries = window.NEUROFRONT_TRANSLATIONS || { en: {} }
  const languages = [
    ["en", "English"], ["hi", "हिन्दी"], ["mr", "मराठी"],
    ["bn", "বাংলা"], ["ta", "தமிழ்"], ["te", "తెలుగు"],
    ["kn", "ಕನ್ನಡ"], ["ml", "മലയാളം"], ["gu", "ગુજરાતી"],
    ["pa", "ਪੰਜਾਬੀ"], ["or", "ଓଡ଼ିଆ"], ["as", "অসমীয়া"], ["ur", "اردو"]
  ]
  const storageKey = "neurofront.language"
  const sourceKeys = new Map(Object.entries(dictionaries.en).map(([key, value]) => [value, key]))
  const textTargets = new Map()
  const button = document.getElementById("languageButton")
  const label = document.getElementById("languageLabel")
  const menu = document.getElementById("languageMenu")
  const picker = document.getElementById("languagePicker")
  let locale = "en"
  try {
    const saved = localStorage.getItem(storageKey)
    if (languages.some(([code]) => code === saved) && dictionaries[saved]) locale = saved
  } catch {}

  function translate(key, values = {}) {
    const template = dictionaries[locale]?.[key] || dictionaries.en[key] || key
    return template.replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match)
  }

  function localize(source) {
    const key = sourceKeys.get(source)
    if (key) return translate(key)
    const countdown = /^Sit relaxed while baseline calibrates\. About ([\d.]+) seconds remaining\.$/.exec(source)
    return countdown ? translate("baseline.remaining", { seconds: countdown[1] }) : source
  }

  function writeText(element, source) {
    const translated = localize(source)
    if (element.textContent !== translated) element.textContent = translated
    if (locale === "ur") element.setAttribute("dir", "auto")
    else element.removeAttribute("dir")
  }

  function setText(element, source) {
    const previous = textTargets.get(element)
    if (previous?.source === source && previous.locale === locale) return
    textTargets.set(element, { source, locale })
    writeText(element, source)
  }

  function setMessage(element, key, values = {}) {
    textTargets.set(element, { key, values, locale })
    const text = translate(key, values)
    if (element.textContent !== text) element.textContent = text
    if (locale === "ur") element.setAttribute("dir", "auto")
    else element.removeAttribute("dir")
  }

  function closeMenu(restoreFocus = false) {
    menu.hidden = true
    button.setAttribute("aria-expanded", "false")
    if (restoreFocus) button.focus({ preventScroll: true })
  }

  function applyLanguage() {
    document.documentElement.lang = locale
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const source = dictionaries.en[element.dataset.i18n] || element.textContent
      if (!textTargets.has(element)) setText(element, source)
    })
    document.querySelectorAll("[data-i18n-alt]").forEach((element) => {
      element.alt = translate(element.dataset.i18nAlt)
    })
    document.querySelectorAll("[data-i18n-aria-label]").forEach((element) => {
      element.setAttribute("aria-label", translate(element.dataset.i18nAriaLabel))
    })
    for (const [element, entry] of textTargets) {
      if (entry.key) setMessage(element, entry.key, entry.values)
      else setText(element, entry.source)
    }
    const nativeName = languages.find(([code]) => code === locale)[1]
    label.textContent = nativeName
    label.lang = locale
    button.setAttribute("aria-label", `${translate("language")}: ${nativeName}`)
    menu.setAttribute("aria-label", translate("language"))
    menu.querySelectorAll("[role=option]").forEach((option) => {
      const selected = option.dataset.language === locale
      option.setAttribute("aria-selected", String(selected))
      option.tabIndex = selected ? 0 : -1
    })
    document.dispatchEvent(new Event("neurofront:languagechange"))
  }

  for (const [code, nativeName] of languages) {
    const option = document.createElement("li")
    option.id = `language-${code}`
    option.dataset.language = code
    option.lang = code
    option.setAttribute("role", "option")
    option.setAttribute("dir", "auto")
    option.textContent = nativeName
    option.addEventListener("click", () => selectLanguage(code))
    menu.append(option)
  }

  function selectLanguage(code, persist = true) {
    if (!dictionaries[code]) return
    if (locale === code) { if (persist) closeMenu(true); return }
    locale = code
    if (persist && !window.NeuroFrontAccount?.owner()) {
      try { localStorage.setItem(storageKey, locale) } catch {}
    }
    applyLanguage()
    closeMenu(persist)
  }

  function openMenu() {
    const availableHeight = Math.max(120, window.innerHeight - button.getBoundingClientRect().bottom - 20)
    menu.style.maxHeight = `${Math.min(360, availableHeight)}px`
    menu.hidden = false
    button.setAttribute("aria-expanded", "true")
    menu.querySelector('[aria-selected="true"]').focus({ preventScroll: true })
    menu.querySelector('[aria-selected="true"]').scrollIntoView({ block: "nearest" })
  }

  button.addEventListener("click", () => menu.hidden ? openMenu() : closeMenu())
  button.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      openMenu()
    }
  })
  menu.addEventListener("keydown", (event) => {
    const options = Array.from(menu.children)
    const index = options.indexOf(document.activeElement)
    let next = index
    if (event.key === "ArrowDown") next = (index + 1) % options.length
    else if (event.key === "ArrowUp") next = (index - 1 + options.length) % options.length
    else if (event.key === "Home") next = 0
    else if (event.key === "End") next = options.length - 1
    else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault()
      selectLanguage(options[index].dataset.language)
      return
    } else if (event.key === "Tab") {
      closeMenu(true)
      return
    } else return
    event.preventDefault()
    options.forEach((option, position) => { option.tabIndex = position === next ? 0 : -1 })
    options[next].focus({ preventScroll: true })
    options[next].scrollIntoView({ block: "nearest" })
  })
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) {
      event.preventDefault()
      closeMenu(true)
    }
  })
  document.addEventListener("pointerdown", (event) => {
    if (!picker.contains(event.target)) closeMenu()
  })
  picker.addEventListener("focusout", (event) => {
    if (!picker.contains(event.relatedTarget)) closeMenu()
  })
  window.addEventListener("resize", () => closeMenu())

  const statusPill = document.getElementById("statusPill")
  const sizeButton = () => {
    const { width, height } = statusPill.getBoundingClientRect()
    button.style.width = `${width}px`
    button.style.height = `${height}px`
  }
  if ("ResizeObserver" in window) new ResizeObserver(sizeButton).observe(statusPill)
  else window.addEventListener("resize", sizeButton)

  window.NeuroFrontI18n = { setText, setMessage, select: selectLanguage }
  applyLanguage()
  sizeButton()
})()
