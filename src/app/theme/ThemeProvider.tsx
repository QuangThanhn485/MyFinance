import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import {
  applyThemePreference,
  loadThemePreference,
  resolveThemePreference,
  saveThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "@/lib/theme"

type ThemeContextValue = {
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
  setPreference: (next: ThemePreference) => void
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState<ThemePreference>(() => loadThemePreference())
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    applyThemePreference(loadThemePreference()),
  )

  useEffect(() => {
    saveThemePreference(preference)
    setResolvedTheme(applyThemePreference(preference))

    if (preference !== "system") return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const handleChange = () => {
      setResolvedTheme(applyThemePreference("system"))
    }
    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", handleChange)
      return () => media.removeEventListener("change", handleChange)
    }
    media.addListener(handleChange)
    return () => media.removeListener(handleChange)
  }, [preference])

  const toggleTheme = () => {
    setPreference((current) => {
      const active = resolveThemePreference(current)
      return active === "dark" ? "light" : "dark"
    })
  }

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolvedTheme, setPreference, toggleTheme }),
    [preference, resolvedTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error("useTheme must be used within ThemeProvider")
  return context
}

