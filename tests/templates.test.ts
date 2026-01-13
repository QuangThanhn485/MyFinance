// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest"
import {
  EXPENSE_TEMPLATES_STORAGE_KEY,
  getRecentExpenseTemplates,
  loadExpenseTemplates,
  upsertExpenseTemplate,
} from "@/storage/templates"

describe("expense templates", () => {
  beforeEach(() => {
    localStorage.removeItem(EXPENSE_TEMPLATES_STORAGE_KEY)
  })

  it("Add via 'Thêm & Lưu mẫu' creates a recent template", () => {
    const now = "2026-01-05T00:00:00.000Z"
    const templates = upsertExpenseTemplate({
      name: "Mua sắm • Áo",
      amountVnd: 600_000,
      category: "Shopping",
      bucket: "wants",
      note: "Áo",
      now,
    })

    const recent = getRecentExpenseTemplates(templates, 6)
    expect(recent).toHaveLength(1)
    expect(recent[0]?.amount).toBe(600_000)
    expect(recent[0]?.bucket).toBe("WANTS")
    expect(recent[0]?.category).toBe("Shopping")
    expect(recent[0]?.note).toBe("Áo")

    const loaded = loadExpenseTemplates()
    expect(loaded).toHaveLength(1)
  })

  it("deduplicates by amount+category+bucket+note", () => {
    const t1 = upsertExpenseTemplate({
      amountVnd: 600_000,
      category: "Shopping",
      bucket: "wants",
      note: "Áo",
      now: "2026-01-05T00:00:00.000Z",
    })
    expect(t1).toHaveLength(1)

    const t2 = upsertExpenseTemplate({
      amountVnd: 600_000,
      category: "Shopping",
      bucket: "wants",
      note: "Áo",
      now: "2026-01-06T00:00:00.000Z",
    })

    expect(t2).toHaveLength(1)
    expect(t2[0]?.useCount).toBe(2)
    expect(t2[0]?.lastUsedAt).toBe("2026-01-06T00:00:00.000Z")
  })
})

