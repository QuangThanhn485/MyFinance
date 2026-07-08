import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import {
  AlertTriangle,
  Cloud,
  Database,
  DownloadCloud,
  HardDrive,
  UploadCloud,
} from "lucide-react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import {
  type DataSourceConfig,
  type DataSourceMode,
  type StorageComparison,
  type UpstashConfig,
  addDataSourceConflictListener,
  compareLocalAndRemote,
  downloadUpstashToLocal,
  getDataSourceConfig,
  getStorageErrorMessage,
  parseUpstashConfigInput,
  saveDataSourceConfig,
  setDataSourceMode,
  testUpstashConnection,
  uploadLocalToUpstash,
} from "@/storage/dataSource"

type PendingDecision =
  | {
      kind:
        | "config-remote-existing"
        | "activate-upstash-local-newer"
        | "activate-upstash-remote-newer"
        | "activate-upstash-diverged"
        | "activate-local-remote-newer"
        | "boot-local-newer"
        | "boot-remote-newer"
        | "boot-diverged"
        | "background-diverged"
      comparison: StorageComparison
      upstash: UpstashConfig
    }
  | null

type DataSourceContextValue = {
  config: DataSourceConfig
  comparison: StorageComparison | null
  loading: boolean
  syncing: boolean
  saveUpstash: (config: UpstashConfig) => Promise<void>
  activateMode: (mode: DataSourceMode) => Promise<void>
  refresh: () => Promise<StorageComparison | null>
  uploadLocal: () => Promise<void>
  downloadRemote: () => Promise<void>
}

const DataSourceContext = createContext<DataSourceContextValue | null>(null)

async function downloadAndReload(upstash: UpstashConfig) {
  const manifest = await downloadUpstashToLocal(upstash)
  if (manifest) {
    window.setTimeout(() => window.location.reload(), 250)
  }
  return manifest
}

export function DataSourceProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<DataSourceConfig>(() => getDataSourceConfig())
  const [comparison, setComparison] = useState<StorageComparison | null>(null)
  const [pendingDecision, setPendingDecision] = useState<PendingDecision>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [bootChecking, setBootChecking] = useState(() => getDataSourceConfig().mode === "upstash")

  const reloadConfig = useCallback(() => {
    const next = getDataSourceConfig()
    setConfig(next)
    return next
  }, [])

  const refresh = useCallback(async () => {
    const current = reloadConfig()
    if (!current.upstash) {
      setComparison(null)
      return null
    }
    const next = await compareLocalAndRemote(current.upstash)
    setComparison(next)
    return next
  }, [reloadConfig])

  const uploadLocal = useCallback(async () => {
    const current = getDataSourceConfig()
    if (!current.upstash) {
      toast.error("Chưa cấu hình Upstash Redis.")
      return
    }
    setSyncing(true)
    try {
      await uploadLocalToUpstash(current.upstash)
      await refresh()
      toast.success("Đã tải dữ liệu localStorage lên Upstash Redis.")
    } catch (error) {
      toast.error(getStorageErrorMessage(error, "Không thể tải dữ liệu lên Upstash Redis."))
    } finally {
      setSyncing(false)
    }
  }, [refresh])

  const downloadRemote = useCallback(async () => {
    const current = getDataSourceConfig()
    if (!current.upstash) {
      toast.error("Chưa cấu hình Upstash Redis.")
      return
    }
    setSyncing(true)
    try {
      await downloadAndReload(current.upstash)
      toast.success("Đã tải dữ liệu Upstash Redis về localStorage.")
    } catch (error) {
      toast.error(getStorageErrorMessage(error, "Không thể tải dữ liệu từ Upstash Redis."))
    } finally {
      setSyncing(false)
    }
  }, [])

  const saveUpstash = useCallback(
    async (nextConfig: UpstashConfig) => {
      const upstash = parseUpstashConfigInput(nextConfig.url, nextConfig.token)
      setLoading(true)
      try {
        await testUpstashConnection(upstash)
        const current = getDataSourceConfig()
        saveDataSourceConfig({ ...current, upstash, updatedAt: Date.now() })
        setConfig(getDataSourceConfig())

        const nextComparison = await compareLocalAndRemote(upstash)
        setComparison(nextComparison)

        if (!nextComparison.remoteHasData) {
          await uploadLocalToUpstash(upstash)
          await refresh()
          toast.success("Kết nối thành công. Redis đang trống nên dữ liệu localStorage đã được tải lên.")
          return
        }

        setPendingDecision({
          kind: "config-remote-existing",
          comparison: nextComparison,
          upstash,
        })
      } catch (error) {
        toast.error(getStorageErrorMessage(error, "Không thể kết nối Upstash Redis."))
      } finally {
        setLoading(false)
      }
    },
    [refresh],
  )

  const activateMode = useCallback(
    async (mode: DataSourceMode) => {
      const current = getDataSourceConfig()
      setLoading(true)
      try {
        if (mode === "localStorage") {
          if (!current.upstash) {
            setDataSourceMode("localStorage")
            setConfig(getDataSourceConfig())
            toast.success("Đã dùng localStorage.")
            return
          }

          const nextComparison = await compareLocalAndRemote(current.upstash)
          setComparison(nextComparison)
          if (nextComparison.relation === "remote-newer") {
            setPendingDecision({
              kind: "activate-local-remote-newer",
              comparison: nextComparison,
              upstash: current.upstash,
            })
            return
          }

          setDataSourceMode("localStorage", current.upstash)
          setConfig(getDataSourceConfig())
          toast.success("Đã dùng localStorage.")
          return
        }

        if (!current.upstash) {
          toast.error("Hãy cấu hình Upstash Redis trước.")
          return
        }

        await testUpstashConnection(current.upstash)
        const nextComparison = await compareLocalAndRemote(current.upstash)
        setComparison(nextComparison)

        if (!nextComparison.remoteHasData) {
          await uploadLocalToUpstash(current.upstash)
          setDataSourceMode("upstash", current.upstash)
          setConfig(getDataSourceConfig())
          await refresh()
          toast.success("Đã dùng Upstash Redis. Redis trống nên dữ liệu localStorage đã được tải lên.")
          return
        }

        if (nextComparison.relation === "same") {
          setDataSourceMode("upstash", current.upstash)
          setConfig(getDataSourceConfig())
          toast.success("Đã dùng Upstash Redis.")
          return
        }

        setPendingDecision({
          kind:
            nextComparison.relation === "remote-newer"
              ? "activate-upstash-remote-newer"
              : nextComparison.relation === "local-newer"
                ? "activate-upstash-local-newer"
                : "activate-upstash-diverged",
          comparison: nextComparison,
          upstash: current.upstash,
        })
      } catch (error) {
        toast.error(getStorageErrorMessage(error, "Không thể chuyển nguồn dữ liệu."))
      } finally {
        setLoading(false)
      }
    },
    [refresh],
  )

  const resolveUploadLocal = useCallback(async () => {
    if (!pendingDecision) return
    setSyncing(true)
    try {
      await uploadLocalToUpstash(pendingDecision.upstash)
      if (pendingDecision.kind.startsWith("activate-upstash")) {
        setDataSourceMode("upstash", pendingDecision.upstash)
      }
      setConfig(getDataSourceConfig())
      setPendingDecision(null)
      await refresh()
      toast.success("Đã tải localStorage lên Upstash Redis.")
    } catch (error) {
      toast.error(getStorageErrorMessage(error, "Không thể tải localStorage lên Redis."))
    } finally {
      setSyncing(false)
      setBootChecking(false)
    }
  }, [pendingDecision, refresh])

  const resolveDownloadRemote = useCallback(async () => {
    if (!pendingDecision) return
    setSyncing(true)
    try {
      await downloadAndReload(pendingDecision.upstash)
      if (pendingDecision.kind.startsWith("activate-upstash")) {
        setDataSourceMode("upstash", pendingDecision.upstash)
      }
      if (pendingDecision.kind === "activate-local-remote-newer") {
        setDataSourceMode("localStorage", pendingDecision.upstash)
      }
      setConfig(getDataSourceConfig())
      setPendingDecision(null)
      toast.success("Đã tải dữ liệu Upstash Redis về localStorage.")
    } catch (error) {
      toast.error(getStorageErrorMessage(error, "Không thể tải Redis về localStorage."))
    } finally {
      setSyncing(false)
      setBootChecking(false)
    }
  }, [pendingDecision])

  const resolveKeepLocal = useCallback(() => {
    if (!pendingDecision) return
    setDataSourceMode("localStorage", pendingDecision.upstash)
    setConfig(getDataSourceConfig())
    setPendingDecision(null)
    setBootChecking(false)
    toast.info("Đã giữ dữ liệu localStorage hiện tại.")
  }, [pendingDecision])

  useEffect(() => {
    let cancelled = false
    async function bootCheck() {
      const current = getDataSourceConfig()
      if (current.mode !== "upstash" || !current.upstash) {
        setBootChecking(false)
        return
      }

      try {
        const nextComparison = await compareLocalAndRemote(current.upstash)
        if (cancelled) return
        setComparison(nextComparison)

        if (!nextComparison.remoteHasData) {
          await uploadLocalToUpstash(current.upstash)
          if (!cancelled) setBootChecking(false)
          return
        }

        if (nextComparison.relation === "same") {
          setBootChecking(false)
          return
        }

        setPendingDecision({
          kind:
            nextComparison.relation === "remote-newer"
              ? "boot-remote-newer"
              : nextComparison.relation === "local-newer"
                ? "boot-local-newer"
                : "boot-diverged",
          comparison: nextComparison,
          upstash: current.upstash,
        })
      } catch (error) {
        if (!cancelled) {
          toast.error(getStorageErrorMessage(error, "Không thể kiểm tra Upstash Redis."))
          setBootChecking(false)
        }
      }
    }

    void bootCheck()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(
    () =>
      addDataSourceConflictListener((detail) => {
        setComparison(detail.comparison)
        setPendingDecision({
          kind: "background-diverged",
          comparison: detail.comparison,
          upstash: detail.upstash,
        })
      }),
    [],
  )

  const value = useMemo<DataSourceContextValue>(
    () => ({
      config,
      comparison,
      loading,
      syncing,
      saveUpstash,
      activateMode,
      refresh,
      uploadLocal,
      downloadRemote,
    }),
    [activateMode, comparison, config, downloadRemote, loading, refresh, saveUpstash, syncing, uploadLocal],
  )

  const copy = getDecisionCopy(pendingDecision)
  const blockApp = bootChecking && !pendingDecision

  return (
    <DataSourceContext.Provider value={value}>
      {!blockApp ? children : null}

      {blockApp ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/80 backdrop-blur">
          <div className="w-[min(420px,calc(100vw-2rem))] rounded-lg border bg-card p-5 shadow-lg">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Database className="h-5 w-5" />
              </span>
              <div>
                <div className="font-semibold">Đang kiểm tra nguồn dữ liệu</div>
                <div className="text-sm text-muted-foreground">Đang so sánh localStorage và Upstash Redis.</div>
              </div>
            </div>
            <Progress value={65} className="mt-4" />
          </div>
        </div>
      ) : null}

      <AlertDialog open={Boolean(pendingDecision)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              {copy.title}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>{copy.description}</p>
                {pendingDecision ? (
                  <div className="grid gap-2 rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-1.5">
                        <HardDrive className="h-3.5 w-3.5" />
                        localStorage
                      </span>
                      <span>
                        {pendingDecision.comparison.local.keyCount} key · rev{" "}
                        {pendingDecision.comparison.local.revision || 0}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-1.5">
                        <Cloud className="h-3.5 w-3.5" />
                        Upstash Redis
                      </span>
                      <span>
                        {pendingDecision.comparison.remote?.keyCount ?? 0} key · rev{" "}
                        {pendingDecision.comparison.remote?.revision ?? 0}
                      </span>
                    </div>
                  </div>
                ) : null}
                {syncing ? <Progress value={75} /> : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={syncing} onClick={resolveKeepLocal}>
              {copy.keepLocal}
            </AlertDialogCancel>
            <Button variant="outline" disabled={syncing} onClick={resolveUploadLocal}>
              <UploadCloud className="h-4 w-4" />
              {copy.uploadLocal}
            </Button>
            <AlertDialogAction disabled={syncing} onClick={resolveDownloadRemote}>
              <DownloadCloud className="h-4 w-4" />
              {copy.downloadRemote}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </DataSourceContext.Provider>
  )
}

function getDecisionCopy(decision: PendingDecision) {
  if (!decision) {
    return {
      title: "",
      description: "",
      keepLocal: "Giữ local",
      uploadLocal: "Tải local lên Redis",
      downloadRemote: "Tải Redis về local",
    }
  }

  if (decision.kind === "config-remote-existing") {
    return {
      title: "Upstash Redis đã có dữ liệu",
      description:
        "Redis đã có dữ liệu MyFinance. Hãy chọn nguồn dữ liệu muốn giữ trước khi tiếp tục để tránh ghi đè nhầm.",
      keepLocal: "Giữ local",
      uploadLocal: "Ghi local lên Redis",
      downloadRemote: "Ghi Redis vào local",
    }
  }

  if (decision.kind === "background-diverged") {
    return {
      title: "Redis đã thay đổi từ nơi khác",
      description:
        "App vừa dừng một lần đồng bộ nền vì dữ liệu trên Upstash Redis đã thay đổi sau lần sync cuối của trình duyệt này. Hãy chọn nguồn muốn giữ để tránh ghi đè nhầm.",
      keepLocal: "Tạm dừng sync",
      uploadLocal: "Ghi local lên Redis",
      downloadRemote: "Tải Redis về local",
    }
  }

  if (decision.kind === "activate-local-remote-newer") {
    return {
      title: "Redis mới hơn localStorage",
      description:
        "Bạn đang chuyển về localStorage nhưng dữ liệu trên Redis mới hơn. Nên tải Redis về local để tránh mất dữ liệu mới.",
      keepLocal: "Vẫn dùng local",
      uploadLocal: "Ghi local lên Redis",
      downloadRemote: "Tải Redis về local",
    }
  }

  if (decision.kind.includes("local-newer")) {
    return {
      title: "localStorage mới hơn Redis",
      description:
        "Dữ liệu Redis có vẻ cũ hơn localStorage. Bạn có thể tải localStorage lên Redis trước khi dùng Upstash.",
      keepLocal: "Giữ local",
      uploadLocal: "Tải local lên Redis",
      downloadRemote: "Dùng dữ liệu Redis",
    }
  }

  if (decision.kind.includes("remote-newer")) {
    return {
      title: "Redis mới hơn localStorage",
      description:
        "Dữ liệu Upstash Redis mới hơn dữ liệu localStorage hiện tại. Hãy chọn nguồn dữ liệu muốn giữ.",
      keepLocal: "Giữ local",
      uploadLocal: "Ghi local lên Redis",
      downloadRemote: "Tải Redis về local",
    }
  }

  return {
    title: "Dữ liệu hai nơi khác nhau",
    description:
      "localStorage và Upstash Redis khác nhau nhưng không xác định được nguồn mới hơn. Hãy chọn rõ nguồn dữ liệu muốn giữ.",
    keepLocal: "Giữ local",
    uploadLocal: "Ghi local lên Redis",
    downloadRemote: "Tải Redis về local",
  }
}

export function useDataSource() {
  const context = useContext(DataSourceContext)
  if (!context) throw new Error("useDataSource must be used within DataSourceProvider")
  return context
}
