import { AlertTriangle, Cloud, CloudOff, Loader2, PauseCircle, ShieldAlert } from "lucide-react"
import { Link } from "react-router-dom"
import { cn } from "@/lib/utils"
import type { SyncState } from "@/sync/syncEngine"

function formatTime(ms?: number) {
  if (!ms) return ""
  return new Date(ms).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
}

export function describeSyncPhase(sync: SyncState): { tone: "ok" | "warn" | "error" | "muted"; label: string; detail?: string } {
  switch (sync.phase) {
    case "local-only":
      return { tone: "muted", label: "Chỉ lưu trên máy này" }
    case "booting":
      return { tone: "muted", label: "Đang kiểm tra Redis…" }
    case "syncing":
      return { tone: "muted", label: "Đang đồng bộ…" }
    case "idle":
      return sync.dirty
        ? { tone: "warn", label: "Có thay đổi chưa đồng bộ", detail: sync.lastPushAt ? `Lần cuối ${formatTime(sync.lastPushAt)}` : undefined }
        : { tone: "ok", label: `Đã đồng bộ v${sync.baseVersion}`, detail: sync.lastPullAt ? formatTime(sync.lastPullAt) : undefined }
    case "offline":
      return { tone: "warn", label: "Không có mạng — lưu trên máy", detail: "Sẽ đồng bộ khi kết nối lại" }
    case "degraded":
      return { tone: "error", label: "Không đồng bộ được", detail: sync.lastError }
    case "auth-error":
      return { tone: "error", label: "Token Redis không hợp lệ", detail: "Vào trang Dữ liệu để cập nhật" }
    case "too-large":
      return { tone: "error", label: "Dữ liệu vượt giới hạn Redis", detail: sync.lastError }
    case "unsupported":
      return { tone: "error", label: "Redis không hỗ trợ script", detail: "Đồng bộ ghi đã bị khoá để bảo vệ dữ liệu" }
    case "conflict":
      return { tone: "warn", label: "Cần bạn quyết định", detail: "Mở hộp thoại đồng bộ" }
    case "contended":
      return { tone: "warn", label: "Thiết bị khác đang ghi", detail: "Sẽ thử lại sau" }
    case "paused":
      return { tone: "warn", label: "Đồng bộ tạm dừng", detail: "Vào trang Dữ liệu để tiếp tục" }
    default:
      return { tone: "muted", label: sync.phase }
  }
}

export function SyncStatusPill({ sync }: { sync: SyncState }) {
  if (sync.mode !== "upstash") return null
  const info = describeSyncPhase(sync)
  const Icon =
    sync.inFlight || sync.phase === "syncing" || sync.phase === "booting"
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
      <Icon className={cn("h-3.5 w-3.5 shrink-0", (sync.inFlight || sync.phase === "syncing" || sync.phase === "booting") && "animate-spin")} />
      <span className="truncate">{info.label}</span>
      {sync.conflictsCount > 0 ? (
        <span className="rounded-full bg-amber-500/20 px-1.5 text-[10px] font-medium text-amber-800 dark:text-amber-200">
          {sync.conflictsCount} xung đột
        </span>
      ) : null}
    </Link>
  )
}
