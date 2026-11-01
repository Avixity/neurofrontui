(() => {
  const opener = document.getElementById("measureButton")
  const dialog = document.getElementById("setupImageDialog")
  const closeButton = document.getElementById("setupImageClose")
  const cancelButton = document.getElementById("cancelMeasurementButton")
  const beginButton = document.getElementById("beginMeasurementButton")
  let returnFocus = null

  opener.addEventListener("click", () => {
    if (!canStartMeasurement() || dialog.open) return
    returnFocus = document.activeElement
    dialog.returnValue = ""
    dialog.showModal()
    beginButton.focus({ preventScroll: true })
  })
  closeButton.addEventListener("click", () => dialog.close("cancel"))
  cancelButton.addEventListener("click", () => dialog.close("cancel"))
  beginButton.addEventListener("click", () => {
    if (!dialog.open || !canStartMeasurement()) return
    dialog.close("begin")
    startMeasurement()
  })
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return
    const bounds = dialog.getBoundingClientRect()
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close("cancel")
  })
  dialog.addEventListener("close", () => {
    const target = returnFocus && !returnFocus.disabled && !returnFocus.hidden
      ? returnFocus : document.getElementById("connectButton")
    target.focus({ preventScroll: true })
  })
})()
