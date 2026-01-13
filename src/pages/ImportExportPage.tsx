import { useState } from "react"
import { toast } from "sonner"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useAppStore } from "@/store/useAppStore"

const CONFIRM_CODE = "485000"

export default function ImportExportPage() {
  const exportJson = useAppStore((s) => s.actions.exportJson)
  const importJson = useAppStore((s) => s.actions.importJson)
  const resetAll = useAppStore((s) => s.actions.resetAll)

  const [exportText, setExportText] = useState("")
  const [importText, setImportText] = useState("")

  const [resetAllOpen, setResetAllOpen] = useState(false)
  const [resetAllPhrase, setResetAllPhrase] = useState("")

  const canDownload = exportText.trim().length > 0

  const download = () => {
    if (!canDownload) return
    const blob = new Blob([exportText], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = "cttm_export.json"
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Xuất / Nhập dữ liệu
        </h1>
        <p className="text-sm text-muted-foreground">
          Xuất JSON, nhập phục hồi, và rebuild indexes khi cần.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Xuất JSON</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={() => {
                setExportText(exportJson())
                toast.success("Đã tạo JSON export.")
              }}
            >
              Tạo JSON
            </Button>
            <Button
              variant="outline"
              disabled={!canDownload}
              onClick={() => download()}
            >
              Tải file
            </Button>
            <Button
              variant="secondary"
              disabled={!canDownload}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(exportText)
                  toast.success("Đã copy JSON.")
                } catch {
                  toast.error("Không thể copy (trình duyệt chặn).")
                }
              }}
            >
              Copy
            </Button>
          </div>
          <Textarea
            rows={12}
            value={exportText}
            onChange={(e) => setExportText(e.target.value)}
            placeholder="Bấm “Tạo JSON” để xuất dữ liệu…"
          />
          <div className="text-xs text-muted-foreground">
            Export bao gồm toàn bộ state `cttm_v1` (normalized entities + indexes).
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Nhập JSON</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            rows={10}
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Dán JSON export vào đây…"
          />
          <div className="flex flex-wrap gap-2">
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={!importText.trim()}>
                  Nhập & ghi đè dữ liệu
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Xác nhận import</AlertDialogTitle>
                  <AlertDialogDescription>
                    Import sẽ ghi đè toàn bộ dữ liệu hiện tại. App sẽ tự tạo backup trước khi ghi đè để bạn có thể phục hồi nếu cần.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Hủy</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => {
                      const res = importJson(importText)
                      if (!res.ok) {
                        toast.error(res.error)
                        return
                      }
                      toast.success("Đã import dữ liệu. (Đã tạo backup tự động trước khi ghi đè.)")
                      setImportText("")
                      setExportText("")
                    }}
                  >
                    Import
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
            <Button
              variant="outline"
              onClick={() => setImportText("")}
              disabled={!importText.trim()}
            >
              Xóa nội dung
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            Sau import, app sẽ tự rebuild indexes để đảm bảo truy vấn nhanh.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Công cụ</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <AlertDialog
            open={resetAllOpen}
            onOpenChange={(open) => {
              setResetAllOpen(open)
              if (!open) setResetAllPhrase("")
            }}
          >
            <AlertDialogTrigger asChild>
              <Button variant="destructive">Xóa toàn bộ data</Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Xóa toàn bộ dữ liệu?</AlertDialogTitle>
                <AlertDialogDescription>
                  <div className="space-y-2">
                    <div className="font-medium text-destructive">
                      This will DELETE ALL YOUR DATA
                    </div>
                    <div>
                      Thao tác này sẽ xóa toàn bộ dữ liệu đang lưu trong LocalStorage.
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Trước khi xóa, app sẽ tự tạo backup tự động (có thể phục hồi bằng “Nhập &amp; ghi đè dữ liệu”).
                    </div>
                  </div>
                </AlertDialogDescription>
              </AlertDialogHeader>

              <div className="grid gap-2">
                <Label>
                  Nhập mã xác nhận{" "}
                  <span className="font-mono text-foreground">{CONFIRM_CODE}</span>{" "}
                  để tiếp tục
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
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={() => {
                    resetAll()
                    toast.success("Đã xóa toàn bộ dữ liệu. (Đã tạo backup tự động trước khi xóa.)")
                    setImportText("")
                    setExportText("")
                  }}
                >
                  Xóa dữ liệu
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <div className="text-xs text-muted-foreground">
            Tip: Trước khi xóa, bạn có thể bấm “Tạo JSON” để tự lưu thêm 1 bản xuất dữ liệu.
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
