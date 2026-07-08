import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Copy,
  Database,
  Download,
  DownloadCloud,
  FileUp,
  HardDrive,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { todayIso } from "@/lib/date"
import { cn } from "@/lib/utils"
import { useDataSource } from "@/app/DataSourceProvider"
import { collectLocalSnapshot, parseUpstashConfigInput } from "@/storage/dataSource"
import { useAppStore } from "@/store/useAppStore"

const CONFIRM_CODE = "485000"

function getRelationLabel(relation: string) {
  switch (relation) {
    case "same":
      return "Đã đồng bộ"
    case "local-newer":
      return "Local mới hơn"
    case "remote-newer":
      return "Redis mới hơn"
    case "diverged":
      return "Cần chọn nguồn"
    case "remote-empty":
      return "Redis trống"
    default:
      return "Chưa kiểm tra"
  }
}

export default function ImportExportPage() {
  const {
    config: dataSourceConfig,
    comparison,
    loading: dataSourceLoading,
    syncing: dataSourceSyncing,
    saveUpstash,
    activateMode,
    refresh,
    uploadLocal,
    downloadRemote,
  } = useDataSource()
  const exportJson = useAppStore((s) => s.actions.exportJson)
  const importJson = useAppStore((s) => s.actions.importJson)
  const resetAll = useAppStore((s) => s.actions.resetAll)

  const [exportText, setExportText] = useState("")
  const [showExportJson, setShowExportJson] = useState(false)

  const [importText, setImportText] = useState("")
  const [importFileName, setImportFileName] = useState<string | null>(null)
  const [showImportPaste, setShowImportPaste] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [resetAllOpen, setResetAllOpen] = useState(false)
  const [resetAllPhrase, setResetAllPhrase] = useState("")
  const [upstashUrl, setUpstashUrl] = useState(dataSourceConfig.upstash?.url ?? "")
  const [upstashToken, setUpstashToken] = useState(dataSourceConfig.upstash?.token ?? "")

  const hasImportData = importText.trim().length > 0
  const dataSourceBusy = dataSourceLoading || dataSourceSyncing
  const upstashConfigured = Boolean(dataSourceConfig.upstash?.url && dataSourceConfig.upstash?.token)
  const localManifest = comparison?.local ?? collectLocalSnapshot(false).manifest
  const remoteManifest = comparison?.remote ?? null
  const relation = comparison?.relation ?? "remote-empty"
  const relationText = getRelationLabel(relation)
  const activeModeLabel = dataSourceConfig.mode === "upstash" ? "Upstash Redis" : "localStorage"
  const parsedUpstashConfig = parseUpstashConfigInput(upstashUrl, upstashToken)
  const canSaveUpstash = Boolean(parsedUpstashConfig.url && parsedUpstashConfig.token)

  useEffect(() => {
    setUpstashUrl(dataSourceConfig.upstash?.url ?? "")
    setUpstashToken(dataSourceConfig.upstash?.token ?? "")
  }, [dataSourceConfig.upstash?.token, dataSourceConfig.upstash?.url])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const generateJson = () => {
    const text = exportJson()
    setExportText(text)
    return text
  }

  const downloadBackup = () => {
    const text = generateJson()
    const blob = new Blob([text], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `myfinance-backup-${todayIso()}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast.success("Đã tải file sao lưu.")
  }

  const copyJson = async () => {
    const text = generateJson()
    try {
      await navigator.clipboard.writeText(text)
      toast.success("Đã copy JSON sao lưu.")
    } catch {
      toast.error("Không thể copy (trình duyệt chặn). Hãy dùng “Tải file”.")
    }
  }

  const handleFileChosen = (file: File | null) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : ""
      setImportText(text)
      setImportFileName(file.name)
      setShowImportPaste(false)
    }
    reader.onerror = () => toast.error("Không đọc được file.")
    reader.readAsText(file)
  }

  const clearImport = () => {
    setImportText("")
    setImportFileName(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  const doImport = () => {
    const res = importJson(importText)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success("Đã phục hồi dữ liệu. (Đã tự tạo bản sao lưu trước khi ghi đè.)")
    clearImport()
    setExportText("")
  }

  const saveUpstashConfig = async () => {
    setUpstashUrl(parsedUpstashConfig.url)
    setUpstashToken(parsedUpstashConfig.token)
    await saveUpstash(parsedUpstashConfig)
  }

  const formatManifestTime = (timestamp?: number) => {
    if (!timestamp) return "Chưa có"
    return new Date(timestamp).toLocaleString("vi-VN")
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 sm:space-y-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Dữ liệu</h1>
        <p className="text-sm text-muted-foreground">
          Chọn nơi app đọc ghi dữ liệu, đồng bộ với Upstash Redis, hoặc xuất nhập file sao lưu khi cần.
        </p>
      </div>

      <Card className="border-sky-500/30">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/10 text-sky-600 dark:text-sky-400">
                <Database className="h-5 w-5" />
              </span>
              <div>
                <CardTitle className="text-base">Nguồn lưu trữ</CardTitle>
                <div className="text-xs text-muted-foreground">
                  Đang dùng <span className="font-medium text-foreground">{activeModeLabel}</span>
                </div>
              </div>
            </div>
            <Badge variant="outline" className="gap-1 border-sky-500/40 text-sky-700 dark:text-sky-400">
              {dataSourceBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {dataSourceBusy ? "Đang kiểm tra" : relationText}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              className={cn(
                "rounded-lg border p-4 text-left transition hover:border-primary/50 hover:bg-muted/40",
                dataSourceConfig.mode === "localStorage" && "border-primary bg-primary/5",
              )}
              disabled={dataSourceBusy}
              onClick={() => void activateMode("localStorage")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="font-medium">localStorage</span>
                </div>
                {dataSourceConfig.mode === "localStorage" ? <Badge>Đang dùng</Badge> : null}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Dữ liệu nằm trong trình duyệt hiện tại. Phù hợp khi chỉ dùng một máy hoặc cần chế độ offline.
              </p>
            </button>

            <button
              type="button"
              className={cn(
                "rounded-lg border p-4 text-left transition hover:border-primary/50 hover:bg-muted/40",
                dataSourceConfig.mode === "upstash" && "border-primary bg-primary/5",
              )}
              disabled={dataSourceBusy || !upstashConfigured}
              onClick={() => void activateMode("upstash")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Cloud className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                  <span className="font-medium">Upstash Redis</span>
                </div>
                {dataSourceConfig.mode === "upstash" ? <Badge>Đang dùng</Badge> : null}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                App đọc ghi qua Redis bằng REST URL và token. Khi có chênh lệch dữ liệu, app sẽ hỏi trước khi ghi đè.
              </p>
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="mb-3 flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-muted-foreground" />
                <div className="text-sm font-medium">Cấu hình Upstash Redis</div>
              </div>
              <div className="grid gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="upstash-url">REST URL</Label>
                  <Input
                    id="upstash-url"
                    value={upstashUrl}
                    onChange={(event) => setUpstashUrl(event.target.value)}
                    placeholder="https://..."
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="upstash-token">REST token</Label>
                  <Input
                    id="upstash-token"
                    type="password"
                    value={upstashToken}
                    onChange={(event) => setUpstashToken(event.target.value)}
                    placeholder="AX..."
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                  <p className="text-xs text-muted-foreground">
                    Token chỉ lưu trong trình duyệt này và không được đồng bộ lên Redis.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => void saveUpstashConfig()} disabled={dataSourceBusy || !canSaveUpstash}>
                    {dataSourceBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Lưu & kiểm tra
                  </Button>
                  <Button variant="outline" onClick={() => void refresh()} disabled={dataSourceBusy || !upstashConfigured}>
                    <RefreshCw className={cn("h-4 w-4", dataSourceBusy && "animate-spin")} />
                    Kiểm tra lại
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-medium">Trạng thái dữ liệu</div>
                <Badge variant="secondary">{relationText}</Badge>
              </div>
              <div className="space-y-3 text-sm">
                <div className="rounded-md bg-background p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">localStorage</span>
                    <span className="font-medium">{localManifest.keyCount} keys</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{formatManifestTime(localManifest.updatedAt)}</div>
                </div>
                <div className="rounded-md bg-background p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground">Upstash Redis</span>
                    <span className="font-medium">{remoteManifest ? `${remoteManifest.keyCount} keys` : "Chưa có data"}</span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{formatManifestTime(remoteManifest?.updatedAt)}</div>
                </div>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                <Button variant="outline" onClick={() => void uploadLocal()} disabled={dataSourceBusy || !upstashConfigured}>
                  <UploadCloud className="h-4 w-4" />
                  Tải local lên Redis
                </Button>
                <Button variant="outline" onClick={() => void downloadRemote()} disabled={dataSourceBusy || !remoteManifest}>
                  <DownloadCloud className="h-4 w-4" />
                  Tải Redis về local
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ------------------------------- XUẤT (an toàn) ------------------------------- */}
        <Card className="border-emerald-500/30">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <Download className="h-5 w-5" />
                </span>
                <div>
                  <CardTitle className="text-base">Xuất — Sao lưu dữ liệu</CardTitle>
                  <div className="text-xs text-muted-foreground">Tải một bản sao về máy</div>
                </div>
              </div>
              <Badge
                variant="outline"
                className="gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
              >
                <ShieldCheck className="h-3.5 w-3.5" />
                An toàn
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Lưu toàn bộ dữ liệu của bạn (chi tiêu, ngân sách, quỹ, cài đặt…) thành một file. Thao
              tác này <span className="font-medium text-foreground">không thay đổi</span> gì trong
              app.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                className="bg-emerald-600 text-white hover:bg-emerald-600/90"
                onClick={downloadBackup}
              >
                <Download className="h-4 w-4" />
                Tải file sao lưu
              </Button>
              <Button variant="outline" onClick={copyJson}>
                <Copy className="h-4 w-4" />
                Copy JSON
              </Button>
              <Button
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => {
                  if (!exportText) generateJson()
                  setShowExportJson((v) => !v)
                }}
              >
                {showExportJson ? "Ẩn nội dung" : "Xem nội dung"}
              </Button>
            </div>
            {showExportJson ? (
              <Textarea
                rows={10}
                readOnly
                value={exportText}
                className="font-mono text-xs"
                placeholder="Nội dung JSON sao lưu…"
              />
            ) : null}
          </CardContent>
        </Card>

        {/* ------------------------------- NHẬP (ghi đè) ------------------------------- */}
        <Card className="border-amber-500/40 bg-amber-500/[0.03]">
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
                  <Upload className="h-5 w-5" />
                </span>
                <div>
                  <CardTitle className="text-base">Nhập — Phục hồi dữ liệu</CardTitle>
                  <div className="text-xs text-muted-foreground">Từ file sao lưu đã có</div>
                </div>
              </div>
              <Badge variant="outline" className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" />
                Ghi đè
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Nhập sẽ <span className="font-semibold">ghi đè toàn bộ dữ liệu hiện tại</span>. App
                tự tạo bản sao lưu trước khi ghi đè để có thể phục hồi lại.
              </span>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => handleFileChosen(e.target.files?.[0] ?? null)}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
                <FileUp className="h-4 w-4" />
                Chọn file .json
              </Button>
              <Button
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => setShowImportPaste((v) => !v)}
              >
                {showImportPaste ? "Ẩn dán JSON" : "Hoặc dán JSON"}
              </Button>
            </div>

            {importFileName ? (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <span className="min-w-0 truncate">
                  Đã chọn: <span className="font-medium">{importFileName}</span>
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs"
                  onClick={clearImport}
                >
                  Bỏ chọn
                </Button>
              </div>
            ) : null}

            {showImportPaste ? (
              <Textarea
                rows={8}
                value={importText}
                onChange={(e) => {
                  setImportText(e.target.value)
                  setImportFileName(null)
                }}
                className="font-mono text-xs"
                placeholder="Dán nội dung JSON sao lưu vào đây…"
              />
            ) : null}

            <div className="flex flex-wrap gap-2 pt-1">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="destructive" disabled={!hasImportData}>
                    <Upload className="h-4 w-4" />
                    Ghi đè bằng dữ liệu này
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                      Ghi đè toàn bộ dữ liệu?
                    </AlertDialogTitle>
                    <AlertDialogDescription asChild>
                      <div className="space-y-2">
                        <div>
                          Toàn bộ dữ liệu hiện tại sẽ bị{" "}
                          <span className="font-semibold text-destructive">thay thế</span> bằng
                          {importFileName ? (
                            <>
                              {" "}nội dung từ <span className="font-medium">{importFileName}</span>.
                            </>
                          ) : (
                            <> nội dung JSON đã dán.</>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          App tự tạo bản sao lưu trước khi ghi đè.
                        </div>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Hủy</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={doImport}
                    >
                      Ghi đè & phục hồi
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>

              {hasImportData ? (
                <Button variant="outline" onClick={clearImport}>
                  Xóa nội dung
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ------------------------------- VÙNG NGUY HIỂM ------------------------------- */}
      <Card className="border-destructive/40">
        <CardHeader className="pb-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <Trash2 className="h-5 w-5" />
            </span>
            <div>
              <CardTitle className="text-base text-destructive">Vùng nguy hiểm</CardTitle>
              <div className="text-xs text-muted-foreground">Xóa vĩnh viễn toàn bộ dữ liệu</div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Xóa sạch mọi dữ liệu đang lưu trên trình duyệt này.{" "}
            <span className="font-medium text-foreground">
              Nên bấm “Tải file sao lưu” trước khi xóa.
            </span>{" "}
            App vẫn tự tạo một bản sao lưu tự động, có thể phục hồi bằng phần Nhập.
          </p>

          <AlertDialog
            open={resetAllOpen}
            onOpenChange={(open) => {
              setResetAllOpen(open)
              if (!open) setResetAllPhrase("")
            }}
          >
            <AlertDialogTrigger asChild>
              <Button variant="destructive">
                <Trash2 className="h-4 w-4" />
                Xóa toàn bộ dữ liệu
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                  Xóa toàn bộ dữ liệu?
                </AlertDialogTitle>
                <AlertDialogDescription asChild>
                  <div className="space-y-2">
                    <div className="font-medium text-destructive">
                      Thao tác này sẽ XÓA TOÀN BỘ DỮ LIỆU của bạn.
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Trước khi xóa, app sẽ tự tạo bản sao lưu (có thể phục hồi ở phần Nhập).
                    </div>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="grid gap-2">
                <Label>
                  Nhập mã xác nhận{" "}
                  <span className="font-mono text-foreground">{CONFIRM_CODE}</span> để tiếp tục
                </Label>
                <Input
                  value={resetAllPhrase}
                  onChange={(e) => setResetAllPhrase(e.target.value)}
                  placeholder={CONFIRM_CODE}
                  inputMode="numeric"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                />
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel>Hủy</AlertDialogCancel>
                <AlertDialogAction
                  disabled={resetAllPhrase !== CONFIRM_CODE}
                  className={cn(
                    "bg-destructive text-destructive-foreground hover:bg-destructive/90",
                    resetAllPhrase !== CONFIRM_CODE && "opacity-50",
                  )}
                  onClick={() => {
                    resetAll()
                    toast.success("Đã xóa toàn bộ dữ liệu. (Đã tự tạo bản sao lưu trước khi xóa.)")
                    clearImport()
                    setExportText("")
                  }}
                >
                  Xóa dữ liệu
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  )
}
