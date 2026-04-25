import { describe, expect, it } from "vitest"
import { computePacedAmountToDateVnd } from "@/domain/finance/pace"

describe("computePacedAmountToDateVnd", () => {
  it("keeps the existing monthly pace rounding formula", () => {
    expect(
      computePacedAmountToDateVnd({
        monthlyAmountVnd: 2_000_000,
        dayOfMonth: 5,
        daysInMonth: 30,
      }),
    ).toBe(333_333)
  })
})
