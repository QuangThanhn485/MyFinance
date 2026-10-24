import type { HistoryGroup, HistoryOp } from "@/ledger/engine"
import { splitRecordKey, type Collection } from "@/ledger/records"
import { formatVnd } from "@/lib/currency"

/** Mô tả ngắn gọn bằng tiếng Việt cho một nhóm thao tác trong sổ cái. */

const NOUNS: Record<Collection, string> = {
  settings: "cài đặt chung",
  monthSettings: "cấu hình tháng",
  category: "danh mục",
  expense: "khoản chi",
  fixedCost: "chi phí cố định",
  purchasePlan: "kế hoạch mua",
  savingsTx: "giao dịch quỹ",
  budgetAdj: "điều chỉnh ngân sách",
  caps: "hạn mức chi",
  monthLock: "khoá sổ tháng",
  reconciliation: "đối soát số dư",
  openingSource: "nguồn số dư đầu tháng",
  template: "mẫu chi nhanh",
}

const MONTH_KEYED = new Set<Collection>(["monthSettings", "budgetAdj", "caps", "monthLock", "reconciliation", "openingSource"])

const VERBS: Record<HistoryOp["t"], string> = {
  put: "Thêm/ghi",
  init: "Tạo tự động",
  patch: "Sửa",
  del: "Xoá",
}

const FIELD_LABELS: Record<string, string> = {
  amountVnd: "số tiền",
  priceVnd: "giá",
  paidAmountVnd: "đã trả",
  note: "ghi chú",
  date: "ngày",
  category: "danh mục",
  bucket: "nhóm",
  name: "tên",
  label: "tên",
  amount: "số tiền",
  month: "tháng",
  active: "trạng thái",
  targetDate: "ngày dự kiến",
  priority: "ưu tiên",
  forced: "bắt buộc",
  defaultBucket: "nhóm mặc định",
  monthlyIncomeVnd: "thu nhập",
  extraIncomeMonthlyVnd: "thu nhập thêm",
  paydayDayOfMonth: "ngày nhận lương",
  debtPaymentMonthlyVnd: "trả nợ",
  debtPaymentPaidVnd: "đã trả nợ",
  budgetRule: "quy tắc ngân sách",
  emergencyFundTargetMonths: "mục tiêu quỹ",
  emergencyFundCurrentVnd: "quỹ đầu tháng",
  actualSavingsBalanceVnd: "số dư tiết kiệm",
  essentialVariableBaselineVnd: "chi thiết yếu",
  customSavingsGoalVnd: "mục tiêu tiết kiệm",
  source: "nguồn",
  settings: "cấu hình",
}

/** Field chỉ phản ánh việc DÙNG mẫu (không phải sửa nội dung mẫu). */
const TEMPLATE_USAGE_FIELDS = new Set(["lastUsedAt", "useCount", "updatedAt"])

function money(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? formatVnd(value) : ""
}

function describeSingle(op: HistoryOp): string {
  const parsed = splitRecordKey(op.key)
  if (!parsed) return op.key
  const noun = NOUNS[parsed.collection]
  const where = MONTH_KEYED.has(parsed.collection) ? ` ${parsed.id}` : ""
  const verb = op.t === "put" ? "Thêm" : VERBS[op.t]
  const v = op.v ?? {}
  if (parsed.collection === "expense" && (op.t === "put" || op.t === "patch")) {
    const parts = [money(v.amountVnd), typeof v.note === "string" ? v.note : "", typeof v.date === "string" ? v.date : ""].filter(Boolean)
    return `${verb} ${noun}${parts.length ? ` · ${parts.join(" · ")}` : ""}`
  }
  if ((parsed.collection === "fixedCost" || parsed.collection === "purchasePlan") && (op.t === "put" || op.t === "patch")) {
    const name = typeof v.name === "string" ? v.name : ""
    const amount = money(v.amountVnd ?? v.priceVnd)
    const paid = parsed.collection === "fixedCost" && op.t === "patch" && v.paidAmountVnd !== undefined ? `đã trả ${money(v.paidAmountVnd)}` : ""
    const parts = [name, amount, paid].filter(Boolean)
    return `${verb} ${noun}${parts.length ? ` · ${parts.join(" · ")}` : ""}`
  }
  if (parsed.collection === "savingsTx" && op.t === "put") {
    const kind = v.type === "withdraw" ? "Rút quỹ" : "Nạp quỹ"
    return `${kind} ${money(v.amountVnd)}${typeof v.reason === "string" && v.reason ? ` · ${v.reason}` : ""}`
  }
  if (op.t === "patch") {
    const changed = [...Object.keys(v), ...(op.u ?? [])]
    if (parsed.collection === "template" && changed.every((field) => TEMPLATE_USAGE_FIELDS.has(field))) return "Dùng mẫu chi nhanh"
    const fields = [...new Set(changed.filter((field) => field !== "updatedAt").map((field) => FIELD_LABELS[field] ?? field))]
    return `${verb} ${noun}${where}${fields.length ? ` (${fields.slice(0, 3).join(", ")}${fields.length > 3 ? "…" : ""})` : ""}`
  }
  return `${verb} ${noun}${where}`
}

export function describeGroupTitle(group: HistoryGroup): string {
  const tx = group.tx
  if (tx === "import-local") return "Nhập dữ liệu sẵn có trên máy"
  if (tx === "migrate") return "Chuyển dữ liệu lên sổ cái"
  if (tx === "join") return "Gộp dữ liệu của một thiết bị vào sổ cái"
  if (tx === "rejoin") return "Khởi tạo lại sổ cái từ dữ liệu máy"
  if (tx === "legacy-bridge") return "Nhận dữ liệu từ tab bản cũ"
  if (tx.startsWith("undo-")) return "Hoàn tác"
  if (tx.startsWith("restore-")) return "Khôi phục về thời điểm trước"
  if (group.ops.length === 1) return describeSingle(group.ops[0])
  const prefix = tx.startsWith("auto-") ? "Tự động: " : ""
  const counts = new Map<string, number>()
  for (const op of group.ops) {
    const parsed = splitRecordKey(op.key)
    const label = `${VERBS[op.t].toLowerCase()} ${parsed ? NOUNS[parsed.collection] : op.key}`
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  const parts = [...counts.entries()].slice(0, 3).map(([label, count]) => (count > 1 ? `${label} ×${count}` : label))
  const text = parts.join(", ")
  return `${prefix}${text.charAt(0).toUpperCase()}${text.slice(1)}${counts.size > 3 ? "…" : ""}`
}

export function describeGroupDetails(group: HistoryGroup, limit = 4): string[] {
  if (group.ops.length <= 1) return []
  const lines = group.ops.slice(0, limit).map(describeSingle)
  if (group.ops.length > limit) lines.push(`… và ${group.ops.length - limit} thay đổi khác`)
  return lines
}
