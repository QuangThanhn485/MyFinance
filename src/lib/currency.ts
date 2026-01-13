export function formatVnd(amountVnd: number) {
  const safe = Number.isFinite(amountVnd) ? Math.trunc(amountVnd) : 0
  return `${new Intl.NumberFormat("vi-VN").format(safe)} ₫`
}

export function formatVndNumber(amountVnd: number) {
  const safe = Number.isFinite(amountVnd) ? Math.trunc(amountVnd) : 0
  const v = Math.max(0, safe)
  return new Intl.NumberFormat("vi-VN").format(v)
}

export function formatVndCompact(amountVnd: number) {
  const safe = Number.isFinite(amountVnd) ? Math.trunc(amountVnd) : 0
  return new Intl.NumberFormat("vi-VN", { notation: "compact" }).format(safe)
}

export function parseVndInput(raw: string) {
  const cleaned = raw.replace(/[^\d]/g, "")
  if (!cleaned) return 0
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.trunc(n))
}
