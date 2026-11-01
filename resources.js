(() => {
  const grid = document.getElementById("resourceGrid")
  const dialog = document.getElementById("resourceDialog")
  if (!grid || !dialog) return

  const title = document.getElementById("resourceDialogTitle")
  const description = document.getElementById("resourceDialogDescription")
  const body = document.getElementById("resourceDialogBody")
  const sources = document.getElementById("resourceSources")
  const closeButton = document.getElementById("resourceClose")
  const toggle = document.getElementById("resourcesToggle")
  const content = document.getElementById("resourcesContent")
  const preferenceKey = "neurofront.resourcesExpanded"
  const articles = window.NEUROFRONT_RESOURCES || []
  const cards = []
  let selected = null
  let returnFocus = null

  function setExpanded(expanded, persist = true) {
    if (!toggle || !content) return
    toggle.setAttribute("aria-expanded", String(expanded))
    content.hidden = !expanded
    if (persist) {
      try { localStorage.setItem(preferenceKey, String(expanded)) } catch (_) { /* The current view remains usable without storage. */ }
    }
  }

  function openArticle(id, origin = document.activeElement) {
    const article = articles.find((entry) => entry.id === id)
    if (!article) return false
    setExpanded(true)
    selected = article
    returnFocus = origin
    renderArticle()
    if (!dialog.open) dialog.showModal()
    dialog.scrollTop = 0
    closeButton.focus({ preventScroll: true })
    return true
  }

  function translate(key) {
    const dictionaries = window.NEUROFRONT_TRANSLATIONS
    return dictionaries[document.documentElement.lang]?.[key] || dictionaries.en[key] || key
  }

  function write(element, key) {
    element.textContent = translate(key)
    element.setAttribute("dir", document.documentElement.lang === "ur" ? "rtl" : "auto")
  }

  function renderArticle() {
    if (!selected) return
    write(title, `resources.${selected.id}.title`)
    write(description, `resources.${selected.id}.description`)
    body.replaceChildren()
    for (const field of ["p1", "p2"]) {
      const paragraph = document.createElement("p")
      write(paragraph, `resources.${selected.id}.${field}`)
      body.append(paragraph)
    }
    const list = document.createElement("ul")
    for (const source of selected.sources) {
      const item = document.createElement("li")
      const link = document.createElement("a")
      link.textContent = source.label
      link.href = source.url
      link.target = "_blank"
      link.rel = "noopener noreferrer"
      item.append(link)
      list.append(item)
    }
    sources.replaceChildren(list)
  }

  for (const article of articles) {
    const card = document.createElement("article")
    card.className = "resource-card"
    const heading = document.createElement("h3")
    const summary = document.createElement("p")
    const button = document.createElement("button")
    button.type = "button"
    button.className = "resource-read-more action-button ghost"
    button.setAttribute("aria-haspopup", "dialog")
    button.setAttribute("aria-controls", "resourceDialog")
    button.addEventListener("click", () => openArticle(article.id, button))
    card.append(heading, summary, button)
    cards.push({ article, heading, summary, button })
    grid.append(card)
  }

  function refreshLanguage() {
    for (const { article, heading, summary, button } of cards) {
      write(heading, `resources.${article.id}.title`)
      write(summary, `resources.${article.id}.description`)
      write(button, "resources.readMore")
      button.setAttribute("aria-label", `${translate("resources.readMore")}: ${translate(`resources.${article.id}.title`)}`)
    }
    if (dialog.open) renderArticle()
  }

  closeButton.addEventListener("click", () => dialog.close())
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return
    const controls = [...dialog.querySelectorAll('button:not([disabled]), a[href], [tabindex="0"]')].filter((element) => element.getClientRects().length)
    const first = controls[0]
    const last = controls[controls.length - 1]
    if (!first) return
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  })
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return
    const bounds = dialog.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close()
  })
  dialog.addEventListener("close", () => {
    if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus({ preventScroll: true })
    else toggle?.focus({ preventScroll: true })
  })
  toggle?.addEventListener("click", () => setExpanded(toggle.getAttribute("aria-expanded") !== "true"))
  let initiallyExpanded = false
  try { initiallyExpanded = localStorage.getItem(preferenceKey) === "true" } catch (_) { /* Start collapsed when storage is unavailable. */ }
  setExpanded(initiallyExpanded, false)
  window.NeuroFrontResources = Object.freeze({ open: openArticle })
  document.addEventListener("neurofront:languagechange", refreshLanguage)
  refreshLanguage()
})()
