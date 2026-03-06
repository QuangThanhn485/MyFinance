export type ThemePreference = "light" | "dark" | "system"
export type ResolvedTheme = "light" | "dark"

export const THEME_STORAGE_KEY = "smartSpend.ui.theme.v1"

function canUseDom() {
  return typeof window !== "undefined" && typeof document !== "undefined"
}

export function getSystemTheme(): ResolvedTheme {
  if (!canUseDom()) return "light"
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function resolveThemePreference(preference: ThemePreference): ResolvedTheme {
  if (preference === "system") return getSystemTheme()
  return preference
}

export function loadThemePreference(): ThemePreference {
  if (!canUseDom()) return "system"
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY)
    if (raw === "light" || raw === "dark" || raw === "system") return raw
  } catch {
    // ignore
  }
  return "system"
}

export function saveThemePreference(preference: ThemePreference) {
  if (!canUseDom()) return
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // ignore
  }
}

export function applyThemePreference(preference: ThemePreference): ResolvedTheme {
  if (!canUseDom()) return resolveThemePreference(preference)
  const resolved = resolveThemePreference(preference)
  const isDark = resolved === "dark"
  document.documentElement.classList.toggle("dark", isDark)
  document.documentElement.style.colorScheme = resolved
  return resolved
}

export function initializeTheme() {
  const preference = loadThemePreference()
  return applyThemePreference(preference)
}

