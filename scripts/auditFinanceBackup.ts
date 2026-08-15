import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"

import { computeBudgets } from "@/domain/finance/finance"
import {
  computeRemainingDailySpendingCap,
  computeTodayDailySpendingCap,
} from "@/domain/finance/dailySafeCap"
import {
  getEffectiveBudgetAdjustmentForMonth,
  getEffectiveSettingsForMonth,
  getMonthlyIncomeTotalVnd,
} from "@/domain/finance/monthLock"
import type { YearMonth } from "@/domain/types"
import { daysInMonth, previousMonth } from "@/lib/date"
import {
  getExpensesByDate,
  getFixedCostPaymentSummary,
  getMonthToDateTotals,
  getMonthTotals,
} from "@/selectors/expenses"
import { getMonthDayContext } from "@/storage/dayLock"
import {
  getActualMonthlySavingsVnd,
  getEmergencyFundMonthSummary,
  getNextMonthEmergencyOpeningBalance,
} from "@/selectors/savings"
import { rebuildExpenseIndexesFromEntities } from "@/storage/indexes"
import type { CttmState, EntityTable, ExpenseIndexes } from "@/storage/schema"

type Severity = "error" | "warning" | "info"

type Finding = {
  severity: Severity
  code: string
  message: string
  evidence?: string
}

type MonthAudit = {
  month: YearMonth
  locked: boolean
  incomeVnd: number
  fixedPlannedVnd: number
  fixedPaidVnd: number
  fixedPaymentDataComplete: boolean
  variableNeedsVnd: number
  variableWantsVnd: number
  variableSpentVnd: number
  savingsTargetVnd: number
  actualMonthlySavingsVnd: number
  emergencyOpeningVnd: number
  emergencyDepositedVnd: number
  emergencyWithdrawnVnd: number
  emergencyClosingVnd: number
  budgetAllocationDifferenceVnd: number
}

type CurrentSnapshot = {
  asOfDate: string
  incomeVnd: number
  fixedPlannedVnd: number
  fixedPaidVnd: number
  variableBudgetVnd: number
  variableSpentVnd: number
  budgetUsedVnd: number
  actualCashSpentVnd: number
  savingsHeldVnd: number
  emergencyBalanceVnd: number
  fixedRemainingVnd: number
  variableRemainingVnd: number
  systemBalanceVnd: number
  controlSystemBalanceVnd: number
  todaySpentVnd: number
  todayCapVnd: number
  todayRemainingVnd: number
  nextDailyCapVnd: number
  remainingDaysInMonth: number
}

const money = new Intl.NumberFormat("vi-VN")

function formatVnd(value: number) {
  return `${money.format(value)} d`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function unwrapState(value: unknown): CttmState {
  if (!isRecord(value)) throw new Error("Backup is not a JSON object.")
  if (value.schemaVersion !== undefined && value.entities !== undefined) {
    return value as unknown as CttmState
  }
  for (const key of ["data", "state", "cttmState"]) {
    const nested = value[key]
    if (isRecord(nested) && nested.entities !== undefined) {
      return nested as unknown as CttmState
    }
  }
  throw new Error("Cannot find CttmState in backup.")
}

function isValidYearMonth(value: string) {
  if (!/^\d{4}-\d{2}$/.test(value)) return false
  const month = Number(value.slice(5, 7))
  return month >= 1 && month <= 12
}

function isValidIsoDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const month = value.slice(0, 7) as YearMonth
  if (!isValidYearMonth(month)) return false
  const day = Number(value.slice(8, 10))
  return day >= 1 && day <= daysInMonth(month)
}

function isNonnegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && Number.isInteger(value)
}

function sortedUnique(values: string[]) {
  return [...new Set(values)].sort()
}

function auditEntityTable<T extends { id: string }>(
  name: string,
  table: EntityTable<T>,
  findings: Finding[],
) {
  const duplicateIds = table.allIds.filter((id, index) => table.allIds.indexOf(id) !== index)
  const missingEntities = sortedUnique(table.allIds.filter((id) => !table.byId[id]))
  const unlistedEntities = Object.keys(table.byId).filter((id) => !table.allIds.includes(id))
  const mismatchedIds = Object.entries(table.byId)
    .filter(([id, entity]) => entity.id !== id)
    .map(([id]) => id)

  if (duplicateIds.length > 0) {
    findings.push({
      severity: "error",
      code: `${name}.duplicate_ids`,
      message: `${name} contains duplicate IDs in allIds.`,
      evidence: sortedUnique(duplicateIds).join(", "),
    })
  }
  if (missingEntities.length > 0) {
    findings.push({
      severity: "error",
      code: `${name}.missing_entities`,
      message: `${name} has IDs without a matching byId record.`,
      evidence: missingEntities.join(", "),
    })
  }
  if (unlistedEntities.length > 0) {
    findings.push({
      severity: "error",
      code: `${name}.unlisted_entities`,
      message: `${name} has byId records omitted from allIds.`,
      evidence: unlistedEntities.join(", "),
    })
  }
  if (mismatchedIds.length > 0) {
    findings.push({
      severity: "error",
      code: `${name}.mismatched_ids`,
      message: `${name} has records whose id differs from the byId key.`,
      evidence: mismatchedIds.join(", "),
    })
  }
}

function canonicalIndex(index: Record<string, string[]>) {
  return Object.fromEntries(
    Object.entries(index)
      .filter(([, ids]) => ids.length > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, ids]) => [key, sortedUnique(ids)]),
  )
}

function auditIndexes(state: CttmState, findings: Finding[]) {
  const expected = rebuildExpenseIndexesFromEntities(state.entities.expenses)
  const parts: Array<keyof ExpenseIndexes> = [
    "expensesByDate",
    "expensesByMonth",
    "expensesByCategoryMonth",
    "expensesByBucketMonth",
  ]

  for (const part of parts) {
    const actualPart = state.indexes?.[part] ?? {}
    const duplicateEntries = Object.entries(actualPart).flatMap(([key, ids]) =>
      ids.length === new Set(ids).size ? [] : [key],
    )
    if (duplicateEntries.length > 0) {
      findings.push({
        severity: "error",
        code: `indexes.${part}.duplicates`,
        message: `${part} contains duplicate references.`,
        evidence: duplicateEntries.join(", "),
      })
    }

    if (JSON.stringify(canonicalIndex(actualPart)) !== JSON.stringify(canonicalIndex(expected[part]))) {
      findings.push({
        severity: "error",
        code: `indexes.${part}.mismatch`,
        message: `${part} does not match the expense records and can return wrong totals.`,
      })
    }
  }
}

function auditRecords(state: CttmState, asOfDate: string, findings: Finding[]) {
  const categories = new Set(state.expenseCategories.map((category) => category.id))
  const nominalExpenses: string[] = []

  for (const id of state.entities.expenses.allIds) {
    const expense = state.entities.expenses.byId[id]
    if (!expense) continue
    if (!isNonnegativeInteger(expense.amountVnd) || expense.amountVnd === 0) {
      findings.push({ severity: "error", code: "expenses.invalid_amount", message: `Expense ${id} has an invalid amount.` })
    }
    if (isNonnegativeInteger(expense.amountVnd) && expense.amountVnd > 0 && expense.amountVnd <= 100) {
      nominalExpenses.push(`${expense.date}: ${formatVnd(expense.amountVnd)} (${expense.note || id})`)
    }
    if (!isValidIsoDate(expense.date)) {
      findings.push({ severity: "error", code: "expenses.invalid_date", message: `Expense ${id} has invalid date ${expense.date}.` })
    } else if (expense.date > asOfDate) {
      findings.push({ severity: "warning", code: "expenses.future_date", message: `Expense ${id} is dated after backup date.`, evidence: expense.date })
    }
    if (expense.bucket !== "needs" && expense.bucket !== "wants") {
      findings.push({ severity: "error", code: "expenses.invalid_bucket", message: `Expense ${id} has invalid bucket ${expense.bucket}.` })
    }
    if (!categories.has(expense.category)) {
      findings.push({ severity: "error", code: "expenses.missing_category", message: `Expense ${id} references missing category ${expense.category}.` })
    }
  }

  if (nominalExpenses.length > 0) {
    findings.push({
      severity: "warning",
      code: "expenses.nominal_correction_values",
      message: `${nominalExpenses.length} expenses use nominal values of 100 VND or less and are likely corrections/placeholders rather than real cash outflow.`,
      evidence: nominalExpenses.join("; "),
    })
  }

  for (const id of state.entities.fixedCosts.allIds) {
    const fixedCost = state.entities.fixedCosts.byId[id]
    if (!fixedCost) continue
    if (!isValidYearMonth(fixedCost.month)) {
      findings.push({ severity: "error", code: "fixed_costs.invalid_month", message: `Fixed cost ${id} has invalid month ${fixedCost.month}.` })
    }
    if (!isNonnegativeInteger(fixedCost.amountVnd) || !isNonnegativeInteger(fixedCost.paidAmountVnd)) {
      findings.push({ severity: "error", code: "fixed_costs.invalid_amount", message: `Fixed cost ${id} has an invalid planned or paid amount.` })
    }
    if (!categories.has(fixedCost.category)) {
      findings.push({ severity: "error", code: "fixed_costs.missing_category", message: `Fixed cost ${id} references missing category ${fixedCost.category}.` })
    }
    if (fixedCost.paidAmountVnd > fixedCost.amountVnd) {
      findings.push({
        severity: "warning",
        code: "fixed_costs.over_plan",
        message: `Fixed cost ${fixedCost.name} in ${fixedCost.month} is paid above plan.`,
        evidence: `${formatVnd(fixedCost.paidAmountVnd)} > ${formatVnd(fixedCost.amountVnd)}`,
      })
    }
  }

  for (const id of state.entities.savingsTransactions.allIds) {
    const transaction = state.entities.savingsTransactions.byId[id]
    if (!transaction) continue
    if (!isNonnegativeInteger(transaction.amountVnd) || transaction.amountVnd === 0) {
      findings.push({ severity: "error", code: "savings.invalid_amount", message: `Savings transaction ${id} has an invalid amount.` })
    }
    if (!isValidIsoDate(transaction.date)) {
      findings.push({ severity: "error", code: "savings.invalid_date", message: `Savings transaction ${id} has invalid date ${transaction.date}.` })
    } else if (transaction.date > asOfDate) {
      findings.push({ severity: "warning", code: "savings.future_date", message: `Savings transaction ${id} is dated after backup date.`, evidence: transaction.date })
    }
    if (transaction.fund !== "emergency" || !["deposit", "withdraw"].includes(transaction.type)) {
      findings.push({ severity: "error", code: "savings.invalid_type", message: `Savings transaction ${id} has invalid fund/type.` })
    }
  }
}

function configuredMonths(state: CttmState) {
  return sortedUnique([
    ...Object.keys(state.settingsByMonth),
    ...Object.keys(state.monthLocksByMonth),
    ...Object.keys(state.indexes.expensesByMonth),
    ...state.entities.fixedCosts.allIds
      .map((id) => state.entities.fixedCosts.byId[id]?.month)
      .filter((month): month is YearMonth => Boolean(month)),
  ]).filter(isValidYearMonth) as YearMonth[]
}

function auditMonths(state: CttmState, months: YearMonth[], asOfMonth: YearMonth, findings: Finding[]) {
  const rows: MonthAudit[] = []

  for (const month of months) {
    const settings = getEffectiveSettingsForMonth(state, month)
    const totals = getMonthTotals(state, month)
    const payments = getFixedCostPaymentSummary(state, month)
    const budgets = computeBudgets({
      incomeVnd: getMonthlyIncomeTotalVnd(settings),
      fixedCostsVnd: totals.fixedCostsTotal,
      essentialVariableBaselineVnd: settings.essentialVariableBaselineVnd,
      rule: settings.budgetRule,
      adjustment: getEffectiveBudgetAdjustmentForMonth(state, month),
      customSavingsGoalVnd: settings.customSavingsGoalVnd,
    })
    const emergency = getEmergencyFundMonthSummary(state, month)
    const allocationTotal =
      budgets.fixedCostsVnd +
      budgets.essentialVariableBaselineVnd +
      budgets.wantsBudgetVnd +
      budgets.savingsTargetVnd
    const fixedRows = state.entities.fixedCosts.allIds
      .map((id) => state.entities.fixedCosts.byId[id])
      .filter((fixedCost) => fixedCost?.active && fixedCost.month === month)
    const fixedPaymentDataComplete = fixedRows.length === 0 || fixedRows.some((fixedCost) => fixedCost.paidAmountVnd > 0)

    rows.push({
      month,
      locked: Boolean(state.monthLocksByMonth[month]),
      incomeVnd: budgets.incomeVnd,
      fixedPlannedVnd: payments.plannedVnd,
      fixedPaidVnd: payments.paidVnd,
      fixedPaymentDataComplete,
      variableNeedsVnd: totals.variableNeeds,
      variableWantsVnd: totals.variableWants,
      variableSpentVnd: totals.variableTotal,
      savingsTargetVnd: budgets.savingsTargetVnd,
      actualMonthlySavingsVnd: getActualMonthlySavingsVnd(state, month),
      emergencyOpeningVnd: emergency.openingBalanceVnd,
      emergencyDepositedVnd: emergency.depositedVnd,
      emergencyWithdrawnVnd: emergency.withdrawnVnd,
      emergencyClosingVnd: emergency.effectiveBalanceVnd,
      budgetAllocationDifferenceVnd: budgets.incomeVnd - allocationTotal,
    })

    if (budgets.incomeVnd !== allocationTotal) {
      findings.push({
        severity: budgets.incomeVnd < allocationTotal ? "error" : "warning",
        code: "budget.allocation_mismatch",
        message: `Budget allocation for ${month} does not equal income.`,
        evidence: `${formatVnd(allocationTotal)} allocated vs ${formatVnd(budgets.incomeVnd)} income`,
      })
    }
    if (month <= asOfMonth && state.monthLocksByMonth[month] && fixedRows.length > 0 && !fixedPaymentDataComplete) {
      findings.push({
        severity: "warning",
        code: "fixed_costs.payment_history_missing",
        message: `${month} is locked but all fixed-cost paid amounts are zero. Historical cash balance cannot be reconstructed exactly.`,
        evidence: `${fixedRows.length} fixed-cost rows, ${formatVnd(payments.plannedVnd)} planned`,
      })
    }
    if (emergency.openingBalanceVnd + emergency.depositedVnd < emergency.withdrawnVnd) {
      findings.push({
        severity: "error",
        code: "savings.negative_fund",
        message: `Emergency-fund withdrawals exceed available funds in ${month}.`,
      })
    }
  }

  return rows
}

function auditEmergencyContinuity(
  state: CttmState,
  months: YearMonth[],
  asOfMonth: YearMonth,
  findings: Finding[],
) {
  for (const month of months) {
    const previous = previousMonth(month)
    if (!state.settingsByMonth[month] || (!state.settingsByMonth[previous] && !state.monthLocksByMonth[previous])) continue
    const source = state.emergencyFundOpeningSourcesByMonth[month]
    if (source !== "auto") continue

    const actual = Math.max(0, Math.trunc(state.settingsByMonth[month].emergencyFundCurrentVnd ?? 0))
    const expected = getNextMonthEmergencyOpeningBalance(state, previous)
    if (actual !== expected) {
      findings.push({
        severity: month <= asOfMonth ? "error" : "warning",
        code: "savings.stale_auto_opening",
        message: `Auto emergency opening for ${month} is stale.`,
        evidence: `stored ${formatVnd(actual)}, recomputed ${formatVnd(expected)}, difference ${formatVnd(actual - expected)}`,
      })
    }
  }
}

function auditFutureConfigurations(
  state: CttmState,
  asOfMonth: YearMonth,
  findings: Finding[],
) {
  const settingsMonths = Object.keys(state.settingsByMonth)
    .filter(isValidYearMonth)
    .sort() as YearMonth[]

  for (let index = 0; index < settingsMonths.length; index += 1) {
    const month = settingsMonths[index]
    if (month <= asOfMonth) continue
    const previous = previousMonth(month)
    const activeFixedCosts = state.entities.fixedCosts.allIds.filter((id) => {
      const fixedCost = state.entities.fixedCosts.byId[id]
      return fixedCost?.active && fixedCost.month === month
    }).length
    const previousActiveFixedCosts = state.entities.fixedCosts.allIds.filter((id) => {
      const fixedCost = state.entities.fixedCosts.byId[id]
      return fixedCost?.active && fixedCost.month === previous
    }).length

    if (activeFixedCosts === 0 && previousActiveFixedCosts > 0) {
      findings.push({
        severity: "warning",
        code: "future.missing_fixed_costs",
        message: `${month} has settings but no fixed costs although ${previous} has ${previousActiveFixedCosts}.`,
        evidence: "Future reports for this month will overstate available money and savings.",
      })
    }

    const previousConfigured = settingsMonths[index - 1]
    if (previousConfigured && previousConfigured !== previous) {
      findings.push({
        severity: "warning",
        code: "future.configuration_gap",
        message: `${month} is an isolated future configuration after ${previousConfigured}.`,
        evidence: "Inherited settings and emergency opening cannot be treated as a continuous monthly ledger.",
      })
    }
  }
}

function buildCurrentSnapshot(
  state: CttmState,
  asOfDate: string,
  findings: Finding[],
): CurrentSnapshot {
  const month = asOfDate.slice(0, 7) as YearMonth
  const date = asOfDate as `${number}${number}${number}${number}-${number}${number}-${number}${number}`
  const settings = getEffectiveSettingsForMonth(state, month)
  const totals = getMonthTotals(state, month)
  const fixedCosts = getFixedCostPaymentSummary(state, month)
  const budgets = computeBudgets({
    incomeVnd: getMonthlyIncomeTotalVnd(settings),
    fixedCostsVnd: totals.fixedCostsTotal,
    essentialVariableBaselineVnd: settings.essentialVariableBaselineVnd,
    rule: settings.budgetRule,
    adjustment: getEffectiveBudgetAdjustmentForMonth(state, month),
    customSavingsGoalVnd: settings.customSavingsGoalVnd,
  })
  const emergency = getEmergencyFundMonthSummary(state, month, date)
  const variableSpentVnd = getMonthToDateTotals(state, date).variableTotalToDateVnd
  const variableBudgetVnd = budgets.essentialVariableBaselineVnd + budgets.wantsBudgetVnd
  const savingsHeldVnd = budgets.incomeVnd - fixedCosts.plannedVnd - variableBudgetVnd
  const fixedRemainingVnd = fixedCosts.plannedVnd - fixedCosts.paidVnd
  const variableRemainingVnd = variableBudgetVnd - variableSpentVnd
  const systemBalanceVnd =
    emergency.effectiveBalanceVnd + savingsHeldVnd + fixedRemainingVnd + variableRemainingVnd
  const controlSystemBalanceVnd =
    emergency.openingBalanceVnd +
    emergency.depositedVnd -
    emergency.withdrawnVnd +
    budgets.incomeVnd -
    fixedCosts.paidVnd -
    variableSpentVnd
  const dayContext = getMonthDayContext(state, date)
  const todaySpentVnd = getExpensesByDate(state, date).reduce(
    (total, expense) => total + expense.amountVnd,
    0,
  )
  const nextCap = computeRemainingDailySpendingCap({
    incomeVnd: budgets.incomeVnd,
    savingsTargetVnd: budgets.savingsTargetVnd,
    totalSpentVnd: totals.totalSpent,
    remainingDaysInMonth: dayContext.remainingDaysInMonth,
  })
  const todayCap = computeTodayDailySpendingCap({
    incomeVnd: budgets.incomeVnd,
    savingsTargetVnd: budgets.savingsTargetVnd,
    monthTotalSpentVnd: totals.totalSpent,
    todaySpentVnd,
    dayOfMonth: dayContext.dayOfMonth,
    daysInMonth: dayContext.daysInMonth,
  })

  if (systemBalanceVnd !== controlSystemBalanceVnd) {
    findings.push({
      severity: "error",
      code: "reconciliation.control_mismatch",
      message: "Current system balance does not match the independent cash-flow control formula.",
      evidence: `${formatVnd(systemBalanceVnd)} vs ${formatVnd(controlSystemBalanceVnd)}`,
    })
  }

  return {
    asOfDate,
    incomeVnd: budgets.incomeVnd,
    fixedPlannedVnd: fixedCosts.plannedVnd,
    fixedPaidVnd: fixedCosts.paidVnd,
    variableBudgetVnd,
    variableSpentVnd,
    budgetUsedVnd: fixedCosts.plannedVnd + variableSpentVnd,
    actualCashSpentVnd: fixedCosts.paidVnd + variableSpentVnd,
    savingsHeldVnd,
    emergencyBalanceVnd: emergency.effectiveBalanceVnd,
    fixedRemainingVnd,
    variableRemainingVnd,
    systemBalanceVnd,
    controlSystemBalanceVnd,
    todaySpentVnd,
    todayCapVnd: todayCap.dailyTotalCapVnd,
    todayRemainingVnd: todayCap.dailyTotalCapVnd - todaySpentVnd,
    nextDailyCapVnd: nextCap.dailyTotalCapVnd,
    remainingDaysInMonth: dayContext.remainingDaysInMonth,
  }
}

function auditReconciliations(state: CttmState, findings: Finding[]) {
  for (const [month, reconciliation] of Object.entries(state.accountBalanceReconciliationsByMonth)) {
    if (reconciliation.month !== month || reconciliation.asOfDate.slice(0, 7) !== month) {
      findings.push({
        severity: "error",
        code: "reconciliation.month_mismatch",
        message: `Reconciliation key/month/date disagree for ${month}.`,
      })
    }
    if (!reconciliation.calculationSnapshot) {
      findings.push({
        severity: "warning",
        code: "reconciliation.legacy_without_snapshot",
        message: `Reconciliation ${month} has no immutable calculation snapshot.`,
        evidence: `saved as of ${reconciliation.asOfDate}`,
      })
    }
  }
}

function markdownReport(input: {
  backupPath: string
  asOfDate: string
  state: CttmState
  findings: Finding[]
  months: MonthAudit[]
  current: CurrentSnapshot
}) {
  const counts = (severity: Severity) => input.findings.filter((finding) => finding.severity === severity).length
  const lines = [
    "# Finance data audit",
    "",
    `- Backup: \`${input.backupPath}\``,
    `- Data updated at: \`${input.state.updatedAt}\``,
    `- Audit cutoff: \`${input.asOfDate}\``,
    `- Records: ${input.state.entities.expenses.allIds.length} expenses, ${input.state.entities.fixedCosts.allIds.length} fixed costs, ${input.state.entities.savingsTransactions.allIds.length} savings transactions`,
    `- Findings: ${counts("error")} errors, ${counts("warning")} warnings, ${counts("info")} informational`,
    "",
    "## Findings",
    "",
  ]

  if (input.findings.length === 0) lines.push("No data-quality issues detected.")
  for (const finding of input.findings) {
    lines.push(`- **${finding.severity.toUpperCase()} ${finding.code}**: ${finding.message}${finding.evidence ? ` Evidence: ${finding.evidence}.` : ""}`)
  }

  lines.push(
    "",
    "## Current cutoff control",
    "",
    `- Budget used: ${formatVnd(input.current.budgetUsedVnd)} = fixed plan ${formatVnd(input.current.fixedPlannedVnd)} + recorded variable spending ${formatVnd(input.current.variableSpentVnd)}.`,
    `- Actual recorded cash outflow: ${formatVnd(input.current.actualCashSpentVnd)} = fixed paid ${formatVnd(input.current.fixedPaidVnd)} + recorded variable spending ${formatVnd(input.current.variableSpentVnd)}.`,
    `- Remaining variable budget: ${formatVnd(input.current.variableRemainingVnd)} of ${formatVnd(input.current.variableBudgetVnd)}.`,
    `- System balance: ${formatVnd(input.current.systemBalanceVnd)}; independent cash-flow control: ${formatVnd(input.current.controlSystemBalanceVnd)}.`,
    `- Today: spent ${formatVnd(input.current.todaySpentVnd)}, cap ${formatVnd(input.current.todayCapVnd)}, remaining ${formatVnd(input.current.todayRemainingVnd)}. Next-period cap: ${formatVnd(input.current.nextDailyCapVnd)} for ${input.current.remainingDaysInMonth} days.`,
    "",
    "## Monthly ledger",
    "",
    "| Month | Lock | Income | Fixed plan | Fixed paid | Variable spent | Savings target | Actual savings | Emergency opening | Fund movement | Emergency closing |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|",
  )
  for (const row of input.months) {
    lines.push(
      `| ${row.month} | ${row.locked ? "yes" : "no"} | ${formatVnd(row.incomeVnd)} | ${formatVnd(row.fixedPlannedVnd)} | ${formatVnd(row.fixedPaidVnd)} | ${formatVnd(row.variableSpentVnd)} | ${formatVnd(row.savingsTargetVnd)} | ${formatVnd(row.actualMonthlySavingsVnd)} | ${formatVnd(row.emergencyOpeningVnd)} | ${formatVnd(row.emergencyDepositedVnd - row.emergencyWithdrawnVnd)} | ${formatVnd(row.emergencyClosingVnd)} |`,
    )
  }

  lines.push(
    "",
    "## Metric semantics",
    "",
    "- `fixed plan` is reserved monthly budget, not necessarily money already paid.",
    "- `variable spent` is recorded expense cash flow only; unrecorded spending is absent until reconciliation.",
    "- `actual savings` means income minus planned fixed costs minus recorded variable spending, including fixed over-plan. It is final only for a completed/locked month.",
    "- Emergency-fund transactions are separate cash flow and are not counted as monthly expenses.",
    "",
  )
  return `${lines.join("\n")}\n`
}

function main() {
  const backupArg = process.argv[2]
  if (!backupArg) {
    throw new Error("Usage: npm run audit:data -- <backup.json> [report.md]")
  }
  const backupPath = resolve(backupArg)
  const outputPath = resolve(process.argv[3] ?? "reports/data-quality-audit.md")
  const state = unwrapState(JSON.parse(readFileSync(backupPath, "utf8")))
  const asOfDate = state.updatedAt.slice(0, 10)
  if (!isValidIsoDate(asOfDate)) throw new Error(`Invalid state.updatedAt: ${state.updatedAt}`)
  const asOfMonth = asOfDate.slice(0, 7) as YearMonth
  const findings: Finding[] = []

  auditEntityTable("expenses", state.entities.expenses, findings)
  auditEntityTable("fixed_costs", state.entities.fixedCosts, findings)
  auditEntityTable("purchase_plans", state.entities.purchasePlans, findings)
  auditEntityTable("savings_transactions", state.entities.savingsTransactions, findings)
  auditIndexes(state, findings)
  auditRecords(state, asOfDate, findings)
  const months = auditMonths(state, configuredMonths(state), asOfMonth, findings)
  auditEmergencyContinuity(state, months.map((row) => row.month), asOfMonth, findings)
  auditFutureConfigurations(state, asOfMonth, findings)
  auditReconciliations(state, findings)
  const current = buildCurrentSnapshot(state, asOfDate, findings)

  findings.sort((a, b) => {
    const order: Record<Severity, number> = { error: 0, warning: 1, info: 2 }
    return order[a.severity] - order[b.severity] || a.code.localeCompare(b.code)
  })

  mkdirSync(dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, markdownReport({ backupPath, asOfDate, state, findings, months, current }), "utf8")
  process.stdout.write(JSON.stringify({ backupPath, outputPath, asOfDate, findings, current, months }, null, 2))
}

main()
