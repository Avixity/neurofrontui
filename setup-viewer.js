(() => {
  const opener = document.getElementById("setupImageButton")
  const dialog = document.getElementById("setupImageDialog")
  const closeButton = document.getElementById("setupImageClose")
  let returnFocus = null

  opener.addEventListener("click", () => {
    returnFocus = document.activeElement
    dialog.showModal()
    closeButton.focus({ preventScroll: true })
  })
  closeButton.addEventListener("click", () => dialog.close())
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return
    const bounds = dialog.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close()
  })
  dialog.addEventListener("close", () => returnFocus?.focus({ preventScroll: true }))
})()
