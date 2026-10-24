import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Copy,
  Database,
  Download,
  FileUp,
  HardDrive,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
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
import { describeSyncPhase } from "@/app/SyncStatusPill"
import { LedgerHistoryPanel } from "@/components/LedgerHistoryPanel"
import { parseUpstashConfigInput } from "@/storage/dataSource"
import { useAppStore } from "@/store/useAppStore"

const CONFIRM_CODE = "485000"

function formatDateTime(ms?: number) {
  if (!ms) return "Chưa có"
  return new Date(ms).toLocaleString("vi-VN")
}

export default function ImportExportPage() {
  const { config: dataSourceConfig, sync, loading: dataSourceLoading, saveUpstash, activateMode, syncNow } = useDataSource()
  const exportJson = useAppStore((s) => s.actions.exportJson)
  const importJson = useAppStore((s) => s.actions.importJson)
  const resetAll = useAppStore((s) => s.actions.resetAll)
  const entityCount = useAppStore(
    (s) =>
      s.data.entities.expenses.allIds.length +
      s.data.entities.fixedCosts.allIds.length +
      s.data.entities.purchasePlans.allIds.length +
      s.data.entities.savingsTransactions.allIds.length,
  )

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
  const dataSourceBusy = dataSourceLoading || sync.inFlight
  const upstashConfigured = Boolean(dataSourceConfig.upstash?.url && dataSourceConfig.upstash?.token)
  const isUpstashMode = dataSourceConfig.mode === "upstash"
  const activeModeLabel = isUpstashMode ? "Upstash Redis" : "localStorage"
  const parsedUpstashConfig = parseUpstashConfigInput(upstashUrl, upstashToken)
  const canSaveUpstash = Boolean(parsedUpstashConfig.url && parsedUpstashConfig.token)
  const phaseInfo = describeSyncPhase(sync)

  useEffect(() => {
    setUpstashUrl(dataSourceConfig.upstash?.url ?? "")
    setUpstashToken(dataSourceConfig.upstash?.token ?? "")
  }, [dataSourceConfig.upstash?.token, dataSourceConfig.upstash?.url])

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
    toast.success(
      isUpstashMode
        ? "Đã phục hồi dữ liệu và sẽ đồng bộ lên mọi thiết bị. Có thể hoàn tác trong “Nhật ký thay đổi”."
        : "Đã phục hồi dữ liệu. Có thể hoàn tác trong “Nhật ký thay đổi”.",
    )
    clearImport()
    setExportText("")
  }

  const doResetAll = () => {
    resetAll()
    toast.success(
      isUpstashMode
        ? "Đã xóa toàn bộ dữ liệu trên mọi thiết bị. Có thể hoàn tác trong “Nhật ký thay đổi”."
        : "Đã xóa toàn bộ dữ liệu. Có thể hoàn tác trong “Nhật ký thay đổi”.",
    )
    clearImport()
    setExportText("")
    setResetAllOpen(false)
    setResetAllPhrase("")
  }

  const saveUpstashConfig = async () => {
    setUpstashUrl(parsedUpstashConfig.url)
    setUpstashToken(parsedUpstashConfig.token)
    await saveUpstash(parsedUpstashConfig)
  }

  return (
    <div className="mx-auto max-w-5xl space-y-3 sm:space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight sm:text-2xl">Dữ liệu</h1>
        <p className="hidden text-sm text-muted-foreground sm:block">
          Chọn nơi app lưu dữ liệu, đồng bộ nhiều thiết bị qua Upstash Redis, xem/hoàn tác mọi thay đổi, hoặc xuất nhập file.
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
            <Badge
              variant="outline"
              className={cn(
                "gap-1",
                phaseInfo.tone === "ok" && "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
                phaseInfo.tone === "warn" && "border-amber-500/50 text-amber-700 dark:text-amber-300",
                phaseInfo.tone === "error" && "border-destructive/60 text-destructive",
              )}
            >
              {dataSourceBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              {isUpstashMode ? phaseInfo.label : "Chỉ lưu trên máy này"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <button
              type="button"
              className={cn(
                "rounded-lg border p-4 text-left transition hover:border-primary/50 hover:bg-muted/40",
                !isUpstashMode && "border-primary bg-primary/5",
              )}
              disabled={dataSourceBusy}
              onClick={() => void activateMode("localStorage")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <HardDrive className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <span className="font-medium">localStorage</span>
                </div>
                {!isUpstashMode ? <Badge>Đang dùng</Badge> : null}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Dữ liệu chỉ nằm trong trình duyệt này. Phù hợp khi dùng một máy hoặc cần offline hoàn toàn.
              </p>
            </button>

            <button
              type="button"
              className={cn(
                "rounded-lg border p-4 text-left transition hover:border-primary/50 hover:bg-muted/40",
                isUpstashMode && "border-primary bg-primary/5",
              )}
              disabled={dataSourceBusy || !upstashConfigured}
              onClick={() => void activateMode("upstash")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Cloud className="h-4 w-4 text-sky-600 dark:text-sky-400" />
                  <span className="font-medium">Upstash Redis</span>
                </div>
                {isUpstashMode ? <Badge>Đang dùng</Badge> : null}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Đồng bộ nhiều thiết bị bằng sổ cái chỉ-ghi-thêm: mỗi thay đổi là một dòng trong sổ, không thiết bị nào ghi đè được dữ liệu của thiết bị khác.
              </p>
            </button>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
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
                    {dataSourceLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                    Lưu & kiểm tra
                  </Button>
                  <Button variant="outline" onClick={() => void syncNow()} disabled={dataSourceBusy || !isUpstashMode}>
                    <RefreshCw className={cn("h-4 w-4", sync.inFlight && "animate-spin")} />
                    Đồng bộ ngay
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-medium">Trạng thái đồng bộ</div>
                <Badge variant="secondary">{isUpstashMode ? phaseInfo.label : "Tắt"}</Badge>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-3 rounded-md bg-background px-3 py-2">
                  <span className="text-muted-foreground">Máy này</span>
                  <span className="font-medium">
                    {entityCount} mục · {sync.deviceLabel}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md bg-background px-3 py-2">
                  <span className="text-muted-foreground">Sổ cái trên Redis</span>
                  <span className="font-medium">{isUpstashMode && sync.joined ? `${sync.remoteLength} thao tác` : "—"}</span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-md bg-background px-3 py-2">
                  <span className="text-muted-foreground">Chưa gửi lên</span>
                  <span className={cn("font-medium", sync.pending > 0 && "text-amber-700 dark:text-amber-300")}>
                    {sync.pending > 0 ? `${sync.pending} thay đổi` : "Không có"}
                  </span>
                </div>
                <div className="rounded-md bg-background px-3 py-2 text-xs text-muted-foreground">
                  <div>Đồng bộ gần nhất: {formatDateTime(sync.lastSyncAt)}</div>
                  <div>
                    Lưu trên máy: {sync.journalKind === "indexeddb" ? "IndexedDB" : "bộ nhớ tạm (trình duyệt chặn IndexedDB)"}
                  </div>
                  {sync.storageError ? <div className="mt-1 text-destructive">{sync.storageError}</div> : null}
                  {sync.lastError ? <div className="mt-1 text-destructive">{sync.lastError}</div> : null}
                </div>
              </div>
            </div>
          </div>

          <LedgerHistoryPanel />

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
                Nhập sẽ <span className="font-semibold">ghi đè toàn bộ dữ liệu hiện tại</span>
                {isUpstashMode ? " và đồng bộ lên mọi thiết bị" : ""}. Dữ liệu cũ vẫn nằm trong sổ cái — hoàn tác
                được trong “Nhật ký thay đổi”.
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
                          {isUpstashMode ? " Thay đổi này sẽ đồng bộ lên MỌI thiết bị." : ""}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Dữ liệu hiện tại vẫn nằm trong sổ cái; có thể hoàn tác trong “Nhật ký thay đổi”.
                        </div>
                      </div>
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Hủy</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => void doImport()}
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
            Xóa sạch mọi dữ liệu{isUpstashMode ? " trên máy này và trên mọi thiết bị đang đồng bộ" : " đang lưu trên trình duyệt này"}.{" "}
            <span className="font-medium text-foreground">
              Nên bấm “Tải file sao lưu” trước khi xóa.
            </span>{" "}
            Thao tác xoá được ghi vào sổ cái nên vẫn hoàn tác được trong “Nhật ký thay đổi”.
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
                      Thao tác này sẽ XÓA TOÀN BỘ DỮ LIỆU của bạn{isUpstashMode ? " trên mọi thiết bị" : ""}.
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Dữ liệu bị xoá vẫn nằm trong sổ cái; có thể hoàn tác trong “Nhật ký thay đổi”.
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
                <Button
                  disabled={resetAllPhrase !== CONFIRM_CODE}
                  className={cn(
                    "bg-destructive text-destructive-foreground hover:bg-destructive/90",
                    resetAllPhrase !== CONFIRM_CODE && "opacity-50",
                  )}
                  onClick={() => void doResetAll()}
                >
                  Xóa dữ liệu
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  )
}
