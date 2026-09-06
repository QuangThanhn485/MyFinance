import { nanoid } from "nanoid"
import { getExpenseCategoryLabel } from "@/domain/constants"
import { clampMoneyVnd } from "@/domain/finance/finance"
import type { BudgetBucket, ExpenseCategory } from "@/domain/types"
import { monotonicIso } from "@/sync/clock"

export const EXPENSE_TEMPLATES_STORAGE_KEY = "smartSpend.templates.v1"
export const EXPENSE_TEMPLATE_TOMBSTONES_KEY = "mf3.tplTombstones"
export const TEMPLATES_CHANGED_EVENT = "mf3:templates-changed"

export type TemplateBucket = "NEEDS" | "WANTS"

export type ExpenseTemplate = {
  id: string
  name: string
  amount: number
  category: ExpenseCategory
  bucket: TemplateBucket
  note?: string
  lastUsedAt: string
  createdAt: string
  updatedAt: string
  useCount: number
}

function nowIso() {
  return monotonicIso()
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function coerceString(value: unknown, fallback: string) {
  return typeof value === "string" ? value : fallback
}

function coerceNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function normalizeNote(note?: string) {
  const raw = typeof note === "string" ? note : ""
  const trimmed = raw.trim()
  if (!trimmed) return ""
  return trimmed.slice(0, 200)
}

function normalizeBucket(value: unknown): TemplateBucket | null {
  if (value === "NEEDS" || value === "WANTS") return value
  if (value === "needs") return "NEEDS"
  if (value === "wants") return "WANTS"
  return null
}

function normalizeCategory(value: unknown): ExpenseCategory | null {
  if (typeof value !== "string") return null
  const category = value.trim()
  return category ? category : null
}

function signature(input: {
  amount: number
  category: ExpenseCategory
  bucket: TemplateBucket
  note?: string
}) {
  const note = normalizeNote(input.note)
  return `${input.amount}|${input.category}|${input.bucket}|${note}`
}

function deriveTemplateName(input: {
  category: ExpenseCategory
  note?: string
}) {
  const base = getExpenseCategoryLabel(input.category)
  const note = normalizeNote(input.note)
  if (!note) return base
  const shortened = note.length > 40 ? `${note.slice(0, 37)}…` : note
  return `${base} • ${shortened}`
}

export function normalizeTemplate(raw: unknown, fallbackNow: string): ExpenseTemplate | null {
  if (!isRecord(raw)) return null

  const category = normalizeCategory(raw.category)
  const bucket = normalizeBucket(raw.bucket)
  if (!category || !bucket) return null

  const amount = clampMoneyVnd(coerceNumber(raw.amount, 0))
  if (amount <= 0) return null

  const note = normalizeNote(coerceString(raw.note, ""))
  const createdAt = coerceString(raw.createdAt, fallbackNow)
  const lastUsedAt = coerceString(raw.lastUsedAt, createdAt)
  const updatedAt = coerceString(raw.updatedAt, lastUsedAt)
  const useCount = Math.max(1, Math.trunc(coerceNumber(raw.useCount, 1)))
  const id = coerceString(raw.id, `tpl_${nanoid(10)}`)

  const nameFallback = deriveTemplateName({ category, note })
  const name = coerceString(raw.name, nameFallback) || nameFallback

  return {
    id,
    name,
    amount,
    category,
    bucket,
    note: note || undefined,
    createdAt,
    lastUsedAt,
    updatedAt,
    useCount,
  }
}

export function normalizeTemplateList(raw: unknown, fallbackNow = nowIso()): ExpenseTemplate[] {
  if (!Array.isArray(raw)) return []
  const out: ExpenseTemplate[] = []
  for (const item of raw) {
    const t = normalizeTemplate(item, fallbackNow)
    if (t) out.push(t)
  }
  return out
}

export function loadExpenseTemplates(): ExpenseTemplate[] {
  if (typeof localStorage === "undefined") return []
  const raw = localStorage.getItem(EXPENSE_TEMPLATES_STORAGE_KEY)
  if (!raw) return []
  return normalizeTemplateList(safeParseJson(raw))
}

export function loadTemplateTombstones(): Record<string, string> {
  if (typeof localStorage === "undefined") return {}
  const parsed = safeParseJson(localStorage.getItem(EXPENSE_TEMPLATE_TOMBSTONES_KEY) ?? "")
  if (!isRecord(parsed)) return {}
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") out[key] = value
  }
  return out
}

function notifyTemplatesChanged() {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return
  try {
    window.dispatchEvent(new CustomEvent(TEMPLATES_CHANGED_EVENT))
  } catch {
    // ignore
  }
}

function writeTemplatesRaw(templates: ExpenseTemplate[], tombstones: Record<string, string>) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(EXPENSE_TEMPLATES_STORAGE_KEY, JSON.stringify(templates))
    localStorage.setItem(EXPENSE_TEMPLATE_TOMBSTONES_KEY, JSON.stringify(tombstones))
  } catch {
    // quota — giữ nguyên bản cũ
  }
}

/**
 * Ghi danh sách mẫu do người dùng thay đổi. Mẫu nào biến mất so với bản đang lưu
 * được ghi tombstone để xoá lan sang thiết bị khác thay vì "hồi sinh".
 */
export function saveExpenseTemplates(templates: ExpenseTemplate[]) {
  if (typeof localStorage === "undefined") return
  const previous = loadExpenseTemplates()
  const nextIds = new Set(templates.map((t) => t.id))
  const tombstones = loadTemplateTombstones()
  const now = nowIso()
  for (const t of previous) {
    if (!nextIds.has(t.id)) tombstones[t.id] = now
  }
  for (const id of nextIds) delete tombstones[id]
  writeTemplatesRaw(templates, tombstones)
  notifyTemplatesChanged()
}

/** Ghi kết quả đồng bộ (đã merge) — không sinh tombstone mới. */
export function replaceExpenseTemplatesFromSync(templates: ExpenseTemplate[], tombstones: Record<string, string>) {
  writeTemplatesRaw(templates, tombstones)
  notifyTemplatesChanged()
}

export function getRecentExpenseTemplates(
  templates: ExpenseTemplate[],
  limit = 6,
) {
  const lastUsedScore = (t: ExpenseTemplate) => Date.parse(t.lastUsedAt) || 0
  const createdScore = (t: ExpenseTemplate) => Date.parse(t.createdAt) || 0
  return templates
    .slice()
    .sort((a, b) => {
      const diff = lastUsedScore(b) - lastUsedScore(a)
      if (diff !== 0) return diff
      const useDiff = (b.useCount ?? 0) - (a.useCount ?? 0)
      if (useDiff !== 0) return useDiff
      const createdDiff = createdScore(b) - createdScore(a)
      if (createdDiff !== 0) return createdDiff
      return a.name.localeCompare(b.name, "vi")
    })
    .slice(0, Math.max(0, Math.trunc(limit)))
}

export function getAllExpenseTemplatesSorted(
  templates: ExpenseTemplate[],
  categoryLabels: Record<string, string> = {},
) {
  const labelOf = (category: ExpenseCategory) =>
    categoryLabels[category] ?? getExpenseCategoryLabel(category)

  return templates
    .slice()
    .sort((a, b) => {
      const nameDiff = a.name.localeCompare(b.name, "vi")
      if (nameDiff !== 0) return nameDiff
      const categoryDiff = labelOf(a.category).localeCompare(labelOf(b.category), "vi")
      if (categoryDiff !== 0) return categoryDiff
      return a.id.localeCompare(b.id)
    })
}

export function upsertExpenseTemplate(input: {
  name?: string
  amountVnd: number
  category: ExpenseCategory
  bucket: BudgetBucket
  note?: string
  now?: string
}): ExpenseTemplate[] {
  const now = input.now ?? nowIso()
  const templates = loadExpenseTemplates()

  const bucket: TemplateBucket = input.bucket === "needs" ? "NEEDS" : "WANTS"
  const amount = clampMoneyVnd(input.amountVnd)
  const note = normalizeNote(input.note)

  if (amount <= 0) return templates

  const sig = signature({ amount, category: input.category, bucket, note })
  const idx = templates.findIndex(
    (t) =>
      signature({
        amount: t.amount,
        category: t.category,
        bucket: t.bucket,
        note: t.note,
      }) === sig,
  )

  const fallbackName = deriveTemplateName({ category: input.category, note })
  const nextName =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim().slice(0, 80)
      : fallbackName

  let next: ExpenseTemplate[]
  if (idx >= 0) {
    const existing = templates[idx]
    const updated: ExpenseTemplate = {
      ...existing,
      name: existing.name || nextName,
      lastUsedAt: now,
      updatedAt: now,
      useCount: Math.max(1, (existing.useCount ?? 1) + 1),
    }
    next = templates.slice()
    next[idx] = updated
  } else {
    const created: ExpenseTemplate = {
      id: `tpl_${nanoid(10)}`,
      name: nextName,
      amount,
      category: input.category,
      bucket,
      note: note || undefined,
      createdAt: now,
      lastUsedAt: now,
      updatedAt: now,
      useCount: 1,
    }
    next = [...templates, created]
  }

  saveExpenseTemplates(next)
  return next
}

export function touchExpenseTemplate(
  templateId: string,
  now: string = nowIso(),
): ExpenseTemplate[] {
  const templates = loadExpenseTemplates()
  const idx = templates.findIndex((t) => t.id === templateId)
  if (idx < 0) return templates

  const t = templates[idx]
  const updated: ExpenseTemplate = {
    ...t,
    lastUsedAt: now,
    updatedAt: now,
    useCount: Math.max(1, (t.useCount ?? 1) + 1),
  }
  const next = templates.slice()
  next[idx] = updated
  saveExpenseTemplates(next)
  return next
}

export function updateExpenseTemplate(
  templateId: string,
  patch: Partial<{
    name: string
    amount: number
    category: ExpenseCategory
    bucket: TemplateBucket
    note: string
  }>,
): ExpenseTemplate[] {
  const templates = loadExpenseTemplates()
  const idx = templates.findIndex((t) => t.id === templateId)
  if (idx < 0) return templates

  const existing = templates[idx]
  const next: ExpenseTemplate = {
    ...existing,
    name:
      typeof patch.name === "string" && patch.name.trim()
        ? patch.name.trim().slice(0, 80)
        : existing.name,
    amount:
      typeof patch.amount === "number" && Number.isFinite(patch.amount)
        ? clampMoneyVnd(patch.amount)
        : existing.amount,
    category: patch.category ?? existing.category,
    bucket: patch.bucket ?? existing.bucket,
    note:
      typeof patch.note === "string"
        ? normalizeNote(patch.note) || undefined
        : existing.note,
    updatedAt: nowIso(),
  }

  if (next.amount <= 0) return templates

  const updated = templates.slice()
  updated[idx] = next
  saveExpenseTemplates(updated)
  return updated
}
