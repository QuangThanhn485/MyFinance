import { AlertTriangle, Cloud, CloudOff, Loader2, PauseCircle, ShieldAlert } from "lucide-react"
import { Link } from "react-router-dom"
import { cn } from "@/lib/utils"
import type { LedgerSyncState } from "@/ledger/engine"

function formatTime(ms?: number) {
  if (!ms) return ""
  return new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
}

export function describeSyncPhase(sync: LedgerSyncState): { tone: "ok" | "warn" | "error" | "muted"; label: string; detail?: string } {
  if (sync.storageError) return { tone: "error", label: "Không ghi được vào bộ nhớ trình duyệt", detail: sync.storageError }
  const pendingText = sync.pending > 0 ? `${sync.pending} thay đổi chưa gửi` : undefined
  switch (sync.phase) {
    case "local-only":
      return sync.journalKind === "memory"
        ? { tone: "error", label: "Trình duyệt chặn bộ nhớ lâu dài", detail: "Dữ liệu sẽ mất khi đóng tab — hãy bật đồng bộ hoặc đổi trình duyệt" }
        : { tone: "muted", label: "Chỉ lưu trên máy này" }
    case "booting":
      return { tone: "muted", label: "Đang kết nối Redis…", detail: pendingText }
    case "syncing":
      return { tone: "muted", label: "Đang đồng bộ…", detail: pendingText }
    case "migrating":
      return { tone: "muted", label: "Đang chuyển dữ liệu lên sổ cái…", detail: sync.lastError }
    case "idle":
      return sync.pending > 0
        ? { tone: "warn", label: pendingText as string, detail: sync.lastSyncAt ? `Lần cuối ${formatTime(sync.lastSyncAt)}` : undefined }
        : { tone: "ok", label: `Đã đồng bộ · #${sync.cursor}`, detail: sync.lastSyncAt ? formatTime(sync.lastSyncAt) : undefined }
    case "offline":
      return { tone: "warn", label: "Mất kết nối — vẫn lưu trên máy", detail: pendingText ?? "Sẽ đồng bộ khi kết nối lại" }
    case "error":
      return { tone: "error", label: "Chưa đồng bộ được", detail: sync.lastError }
    case "auth-error":
      return { tone: "error", label: "Token Redis không hợp lệ", detail: "Vào trang Dữ liệu để cập nhật" }
    case "unsupported":
      return { tone: "error", label: "Redis không cho chạy script", detail: "Đồng bộ đã khoá để bảo vệ dữ liệu" }
    case "needs-update":
      return { tone: "error", label: "Cần tải lại ứng dụng", detail: sync.lastError }
    case "attention":
      return { tone: "warn", label: "Cần bạn quyết định", detail: "Mở hộp thoại đồng bộ" }
    case "paused":
      return { tone: "warn", label: "Đồng bộ tạm dừng", detail: pendingText ?? "Vào trang Dữ liệu để tiếp tục" }
    default:
      return { tone: "muted", label: sync.phase }
  }
}

export function SyncStatusPill({ sync }: { sync: LedgerSyncState }) {
  const storageProblem = Boolean(sync.storageError) || sync.journalKind === "memory"
  if (sync.mode !== "upstash" && !storageProblem) return null
  const info = describeSyncPhase(sync)
  const busy = sync.inFlight || sync.phase === "syncing" || sync.phase === "booting" || sync.phase === "migrating"
  const Icon = busy
    ? Loader2
    : info.tone === "error"
      ? ShieldAlert
      : sync.phase === "offline"
        ? CloudOff
        : sync.phase === "paused"
          ? PauseCircle
          : info.tone === "warn"
            ? AlertTriangle
            : Cloud

  return (
    <Link
      to="/data"
      title={info.detail ?? info.label}
      className={cn(
        "fixed right-3 z-[60] flex max-w-[calc(100vw-1.5rem)] items-center gap-2 rounded-full border px-3 py-1.5 text-xs shadow-sm backdrop-blur transition",
        "bottom-[calc(env(safe-area-inset-bottom)+4.5rem)] sm:bottom-4",
        info.tone === "ok" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        info.tone === "warn" && "border-amber-500/50 bg-amber-500/10 text-amber-800 dark:text-amber-300",
        info.tone === "error" && "border-destructive/60 bg-destructive/10 text-destructive",
        info.tone === "muted" && "border-border bg-background/90 text-muted-foreground",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", busy && "animate-spin")} />
      <span className="truncate">{info.label}</span>
    </Link>
  )
}
