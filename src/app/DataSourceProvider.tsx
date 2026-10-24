import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { toast } from "sonner"
import { AlertTriangle, Loader2 } from "lucide-react"
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
import { getLedgerEngine } from "@/ledger/appLedger"
import type { LedgerDialog, LedgerDialogChoice, LedgerEngine, LedgerSyncState } from "@/ledger/engine"
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
import { createUpstashClient, pingRedis } from "@/sync/redisProtocol"

type DataSourceContextValue = {
  config: DataSourceConfig
  sync: LedgerSyncState
  loading: boolean
  engine: LedgerEngine
  saveUpstash: (config: UpstashConfig) => Promise<void>
  activateMode: (mode: DataSourceMode) => Promise<void>
  syncNow: () => Promise<void>
}

const DataSourceContext = createContext<DataSourceContextValue | null>(null)

type DialogOption = { choice: LedgerDialogChoice; label: string; variant?: "default" | "outline" | "destructive" | "secondary" }

function getDialogCopy(dialog: LedgerDialog): { title: string; description: string; options: DialogOption[] } {
  switch (dialog.kind) {
    case "remote-empty":
      return {
        title: "Redis không còn sổ cái mà máy này đang đồng bộ",
        description:
          "Database Upstash đang trống (có thể đã bị xoá, hoặc bạn vừa trỏ sang database mới). Dữ liệu trên máy này vẫn nguyên vẹn. Bạn có thể khởi tạo lại sổ cái trên Redis từ dữ liệu máy này.",
        options: [
          { choice: "reseed", label: "Đẩy dữ liệu máy này lên" },
          { choice: "pause", label: "Tạm dừng đồng bộ", variant: "outline" },
        ],
      }
    case "remote-different":
      return {
        title: "Redis đang chứa một sổ cái khác",
        description:
          "Sổ cái trên database này không phải sổ cái máy này đã đồng bộ (đổi database, hoặc database bị thay). Gộp sẽ thêm dữ liệu của máy này vào sổ cái đó mà không xoá gì của nó.",
        options: [
          { choice: "merge-local", label: "Gộp dữ liệu máy này vào" },
          { choice: "pause", label: "Tạm dừng đồng bộ", variant: "outline" },
        ],
      }
    default:
      return { title: "Đồng bộ dữ liệu", description: "", options: [] }
  }
}

export function DataSourceProvider({ children }: { children: React.ReactNode }) {
  const engine = useMemo(() => getLedgerEngine(), [])
  const subscribeToEngine = useMemo(() => engine.subscribe.bind(engine), [engine])
  const getEngineState = useMemo(() => engine.getState.bind(engine), [engine])
  const sync = useSyncExternalStore(subscribeToEngine, getEngineState, getEngineState)
  const [config, setConfig] = useState<DataSourceConfig>(() => getDataSourceConfig())
  const [loading, setLoading] = useState(false)
  const [resolving, setResolving] = useState(false)

  useEffect(() => {
    if ((sync.phase === "error" || sync.phase === "needs-update") && sync.lastError) toast.error(sync.lastError)
  }, [sync.phase, sync.lastError])

  useEffect(() => {
    if (sync.storageError) toast.error(sync.storageError)
  }, [sync.storageError])

  useEffect(() => {
    if (!sync.notice) return
    if (sync.notice.kind === "edit-on-deleted") {
      toast.warning(
        `${sync.notice.count} thay đổi của bạn rơi vào mục đã bị xoá trên thiết bị khác nên không được áp dụng. Có thể khôi phục mục đó trong “Nhật ký thay đổi”.`,
        { duration: 8000 },
      )
    }
    engine.dismissNotice()
  }, [engine, sync.notice])

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
            // Cố đẩy nốt thay đổi trước khi tắt đồng bộ; không bao giờ xoá gì trên máy.
            await engine.syncNow()
            if (engine.pendingCount() > 0) {
              toast.warning("Còn thay đổi chưa đẩy được lên Redis. Chúng vẫn nằm trên máy này và sẽ được gửi khi bật lại đồng bộ.")
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
    async (choice: LedgerDialogChoice, dialogId: number) => {
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
                <p className="text-xs text-muted-foreground">
                  Trong lúc chờ bạn chọn, mọi thao tác vẫn được ghi vào nhật ký trên máy này và không mất.
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
