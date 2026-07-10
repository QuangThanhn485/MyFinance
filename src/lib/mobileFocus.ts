function isLikelyMobileViewport() {
  if (typeof window === "undefined") return false
  return window.matchMedia?.("(pointer: coarse)").matches || window.innerWidth < 768
}

export function keepFocusedFieldVisible(element: HTMLElement | null) {
  if (!element || !isLikelyMobileViewport()) return

  const scroll = () => {
    if (!document.body.contains(element)) return

    element.scrollIntoView({
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    })

    const visualViewport = window.visualViewport
    if (!visualViewport) return

    const rect = element.getBoundingClientRect()
    const safeBottom = visualViewport.height - 24
    const overflow = rect.bottom - safeBottom
    if (overflow > 0) {
      window.scrollBy({ top: overflow + 12, behavior: "smooth" })
    }
  }

  window.setTimeout(scroll, 80)
  window.setTimeout(scroll, 320)
}
