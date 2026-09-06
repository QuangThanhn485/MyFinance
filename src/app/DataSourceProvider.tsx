import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { AlertTriangle, Cloud, HardDrive, Loader2 } from "lucide-react"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { SyncStatusPill } from "@/app/SyncStatusPill"
import {
  type DataSourceConfig,
  type DataSourceMode,
  type UpstashConfig,
  getDataSourceConfig,
  getStorageErrorMessage,
  parseUpstashConfigInput,
  saveDataSourceConfig,
  setDataSourceMode,
} from "@/storage/dataSource"
import { getSyncEngine } from "@/sync/appSync"
import { createUpstashClient, pingRedis } from "@/sync/redisProtocol"
import type { SyncDialog, SyncDialogChoice, SyncEngine, SyncState } from "@/sync/syncEngine"

type DataSourceContextValue = {
  config: DataSourceConfig
  sync: SyncState
  loading: boolean
  engine: SyncEngine
  saveUpstash: (config: UpstashConfig) => Promise<void>
  activateMode: (mode: DataSourceMode) => Promise<void>
  syncNow: () => Promise<void>
}

const DataSourceContext = createContext<DataSourceContextValue | null>(null)

function countEntities(doc: SyncDialog["localDoc"] | null) {
  if (!doc) return 0
  const e = doc.cttm.entities
  return e.expenses.allIds.length + e.fixedCosts.allIds.length + e.purchasePlans.allIds.length + e.savingsTransactions.allIds.length
}

type DialogOption = { choice: SyncDialogChoice; label: string; variant?: "default" | "outline" | "destructive" | "secondary" }

function getDialogCopy(dialog: SyncDialog): { title: string; description: string; options: DialogOption[] } {
  const stats = dialog.stats
  switch (dialog.kind) {
    case "migrate-v2":
      return {
        title: "Kết nối Redis với cơ chế đồng bộ mới",
        description:
          "Dữ liệu trên máy này và bản đang có trên Redis (cơ chế cũ) khác nhau. Bản cũ trên Redis sẽ được lưu trữ lại, không bị xoá. Gộp cả hai là lựa chọn an toàn nhất.",
        options: [
          { choice: "merge", label: "Gộp cả hai (khuyên dùng)" },
          { choice: "keep-local", label: "Dùng dữ liệu máy này", variant: "outline" },
          { choice: "use-remote", label: "Dùng dữ liệu trên Redis", variant: "outline" },
        ],
      }
    case "no-base":
      return {
        title: "Máy này chưa có điểm đồng bộ chung với Redis",
        description:
          "Không thể biết thay đổi nào mới hơn giữa máy này và Redis. Gộp cả hai sẽ giữ toàn bộ dữ liệu của hai bên; bản trên Redis vẫn nằm trong lịch sử để khôi phục.",
        options: [
          { choice: "merge", label: "Gộp cả hai (khuyên dùng)" },
          { choice: "keep-local", label: "Dùng máy này, ghi lên Redis", variant: "outline" },
          { choice: "use-remote", label: "Dùng dữ liệu trên Redis", variant: "outline" },
        ],
      }
    case "mass-delete":
      return {
        title: "Bản trên Redis xoá nhiều dữ liệu",
        description: stats
          ? `Áp dụng sẽ xoá ${stats.missing}/${stats.total} mục đang có trên máy này (có thể do một thiết bị khác vừa xoá hoặc phục hồi file cũ). Bản hiện tại của máy được lưu vào lịch sử trước khi áp dụng.`
          : "Áp dụng sẽ xoá nhiều mục đang có trên máy này. Bản hiện tại của máy được lưu vào lịch sử trước khi áp dụng.",
        options: [
          { choice: "keep-local", label: "Giữ dữ liệu máy này" },
          { choice: "apply", label: "Áp dụng theo Redis", variant: "destructive" },
        ],
      }
    case "remote-reset":
      return {
        title: "Redis không còn dữ liệu đồng bộ trước đó",
        description:
          dialog.remoteVersion > 0
            ? "Dữ liệu trên Redis không thuộc chuỗi đồng bộ mà máy này đang theo (có thể bạn đã trỏ sang database khác, hoặc Redis đã bị xoá rồi ghi lại). Hãy chọn nguồn muốn giữ."
            : "Redis đang trống trong khi máy này từng đồng bộ với nó. Có thể Redis đã bị xoá hoặc bạn đã đổi sang database khác.",
        options: [
          { choice: "push-local", label: "Đẩy dữ liệu máy này lên Redis" },
          ...(dialog.remoteVersion > 0 ? [{ choice: "use-remote" as const, label: "Dùng dữ liệu trên Redis", variant: "outline" as const }] : []),
          { choice: "pause", label: "Tạm dừng đồng bộ", variant: "outline" },
        ],
      }
    case "legacy-changed":
      return {
        title: "Một thiết bị chạy bản cũ vừa ghi dữ liệu",
        description:
          "Có dữ liệu mới được ghi bằng cơ chế đồng bộ cũ (thiết bị chưa tải lại app). Gộp vào để không mất; hãy tải lại app trên mọi thiết bị để dùng cơ chế mới.",
        options: [
          { choice: "merge", label: "Gộp vào" },
          { choice: "ignore", label: "Bỏ qua", variant: "outline" },
        ],
      }
    default:
      return { title: "Đồng bộ dữ liệu", description: "", options: [] }
  }
}

export function DataSourceProvider({ children }: { children: React.ReactNode }) {
  const engine = useMemo(() => getSyncEngine(), [])
  const subscribeToEngine = useMemo(() => engine.subscribe.bind(engine), [engine])
  const getEngineState = useMemo(() => engine.getState.bind(engine), [engine])
  const sync = useSyncExternalStore(subscribeToEngine, getEngineState, getEngineState)
  const [config, setConfig] = useState<DataSourceConfig>(() => getDataSourceConfig())
  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState(false)

  useEffect(() => {
    engine.start()
    return () => engine.stop()
  }, [engine])

  useEffect(() => {
    if (sync.phase === "degraded" && sync.lastError) toast.error(sync.lastError)
  }, [sync.phase, sync.lastError])

  const reloadConfig = useCallback(() => {
    const next = getDataSourceConfig()
    setConfig(next)
    return next
  }, [])

  const syncNow = useCallback(async () => {
    await engine.syncNow({ resume: true })
  }, [engine])

  const saveUpstash = useCallback(
    async (nextConfig: UpstashConfig) => {
      const upstash = parseUpstashConfigInput(nextConfig.url, nextConfig.token)
      setLoading(true)
      try {
        const redis = await createUpstashClient(upstash)
        await pingRedis(redis)
        const current = getDataSourceConfig()
        saveDataSourceConfig({ ...current, upstash, updatedAt: Date.now() })
        reloadConfig()
        if (current.mode === "upstash") {
          engine.restart()
          toast.success("Đã lưu cấu hình. Đang đồng bộ lại với Redis.")
        } else {
          toast.success("Kết nối Upstash Redis thành công. Bấm thẻ “Upstash Redis” để bật đồng bộ.")
        }
      } catch (error) {
        toast.error(getStorageErrorMessage(error, "Không thể kết nối Upstash Redis."))
      } finally {
        setLoading(false)
      }
    },
    [engine, reloadConfig],
  )

  const activateMode = useCallback(
    async (mode: DataSourceMode) => {
      const current = getDataSourceConfig()
      setLoading(true)
      try {
        if (mode === "localStorage") {
          if (current.mode === "upstash" && current.upstash) {
            // Cố gắng đẩy nốt thay đổi trước khi tắt đồng bộ; không bao giờ xoá gì trên máy.
            await engine.syncNow()
            if (engine.isDirty()) {
              toast.warning("Còn thay đổi chưa đẩy được lên Redis. Dữ liệu vẫn nằm trên máy này và sẽ đồng bộ khi bật lại.")
            }
          }
          setDataSourceMode("localStorage", current.upstash)
          reloadConfig()
          engine.restart()
          toast.success("Đã chuyển sang lưu trên máy này.")
          return
        }

        if (!current.upstash) {
          toast.error("Hãy cấu hình Upstash Redis trước.")
          return
        }
        const redis = await createUpstashClient(current.upstash)
        await pingRedis(redis)
        setDataSourceMode("upstash", current.upstash)
        reloadConfig()
        engine.restart()
        toast.success("Đã bật đồng bộ Upstash Redis.")
      } catch (error) {
        toast.error(getStorageErrorMessage(error, "Không thể chuyển nguồn dữ liệu."))
      } finally {
        setLoading(false)
      }
    },
    [engine, reloadConfig],
  )

  const resolve = useCallback(
    async (choice: SyncDialogChoice, dialogId: number) => {
      setResolving(true)
      try {
        await engine.resolveDialog(choice, dialogId)
      } finally {
        setResolving(false)
      }
    },
    [engine],
  )

  const value = useMemo<DataSourceContextValue>(
    () => ({ config, sync, loading, engine, saveUpstash, activateMode, syncNow }),
    [activateMode, config, engine, loading, saveUpstash, sync, syncNow],
  )

  const dialog = sync.dialog
  const copy = dialog ? getDialogCopy(dialog) : null

  return (
    <DataSourceContext.Provider value={value}>
      {children}
      <SyncStatusPill sync={sync} />

      <AlertDialog open={Boolean(dialog)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {copy?.title}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>{copy?.description}</p>
                {dialog ? (
                  <div className="grid gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-1.5">
                        <HardDrive className="h-3.5 w-3.5" />
                        Máy này
                      </span>
                      <span>{countEntities(dialog.localDoc)} mục</span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-1.5">
                        <Cloud className="h-3.5 w-3.5" />
                        {dialog.kind === "migrate-v2" || dialog.kind === "legacy-changed" ? "Redis (bản cũ)" : `Redis v${dialog.remoteVersion}`}
                      </span>
                      <span>{countEntities(dialog.remoteDoc)} mục</span>
                    </div>
                    {dialog.mergedDoc ? (
                      <div className="flex items-center justify-between gap-3">
                        <span>Sau khi gộp</span>
                        <span>{countEntities(dialog.mergedDoc)} mục</span>
                      </div>
                    ) : null}
                    {dialog.remoteHead?.deviceLabel ? (
                      <div className="flex items-center justify-between gap-3">
                        <span>Ghi lần cuối bởi</span>
                        <span>
                          {dialog.remoteHead.deviceLabel} · {new Date(dialog.remoteHead.committedAt).toLocaleString("vi-VN")}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  Mọi lựa chọn đều giữ lại bản trước đó (lịch sử trên Redis và bản lưu trên máy) để có thể khôi phục.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:flex-wrap">
            {copy?.options.map((option) => (
              <Button
                key={option.choice}
                variant={option.variant ?? "default"}
                disabled={resolving || !dialog}
                onClick={() => dialog && void resolve(option.choice, dialog.id)}
              >
                {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {option.label}
              </Button>
            ))}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DataSourceContext.Provider>
  )
}

export function useDataSource() {
  const context = useContext(DataSourceContext)
  if (!context) throw new Error("useDataSource must be used within DataSourceProvider")
  return context
}
