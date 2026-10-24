import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { Download, History, Loader2, RefreshCw, RotateCcw, Undo2 } from "lucide-react"
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
import { useDataSource } from "@/app/DataSourceProvider"
import { describeGroupDetails, describeGroupTitle } from "@/ledger/describe"
import type { HistoryGroup } from "@/ledger/engine"
import { todayIso } from "@/lib/date"
import { cn } from "@/lib/utils"

function formatDateTime(iso: string) {
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? new Date(ms).toLocaleString("vi-VN") : iso
}

function groupKey(group: HistoryGroup) {
  return group.pending ? `pending:${group.dev}:${group.ops[0]?.cseq}` : `seq:${group.firstSeq}`
}

/**
 * Nhật ký thay đổi = đọc thẳng sổ cái. Không có "bản sao lưu" nào khác: hoàn tác hay quay về
 * thời điểm cũ đều là GHI THÊM thao tác mới, lịch sử phía sau vẫn còn nguyên.
 */
export function LedgerHistoryPanel() {
  const { engine, sync } = useDataSource()
  const [groups, setGroups] = useState<HistoryGroup[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [limit, setLimit] = useState(40)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setGroups(await engine.loadHistory(400))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không tải được nhật ký thay đổi.")
    } finally {
      setLoading(false)
    }
  }, [engine])

  useEffect(() => {
    void load()
  }, [load, sync.cursor, sync.joined])

  const undo = async (group: HistoryGroup) => {
    setBusy(groupKey(group))
    try {
      const count = await engine.undoGroup(group)
      toast.success(count > 0 ? `Đã hoàn tác (${count} thay đổi).` : "Không còn gì để hoàn tác — dữ liệu đã giống trước thao tác này.")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không hoàn tác được.")
    } finally {
      setBusy(null)
    }
  }

  const restore = async (group: HistoryGroup) => {
    setBusy(groupKey(group))
    try {
      const count = await engine.restoreBefore(group)
      toast.success(count > 0 ? `Đã đưa dữ liệu về trước thời điểm này (${count} thay đổi).` : "Dữ liệu hiện tại đã giống thời điểm đó.")
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không khôi phục được.")
    } finally {
      setBusy(null)
    }
  }

  const downloadLedger = async () => {
    try {
      const text = await engine.exportLedger()
      const blob = new Blob([text], { type: "application/x-ndjson" })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `myfinance-ledger-${todayIso()}.jsonl`
      a.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Không tải được sổ cái.")
    }
  }

  const visible = (groups ?? []).slice(0, limit)

  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <div className="text-sm font-medium">Nhật ký thay đổi</div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-8" onClick={() => void downloadLedger()}>
            <Download className="h-3.5 w-3.5" />
            Tải sổ cái
          </Button>
          <Button variant="ghost" size="sm" className="h-8" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            Tải lại
          </Button>
        </div>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Mọi thay đổi trên mọi thiết bị đều được ghi thêm vào sổ cái, không thiết bị nào ghi đè được dữ liệu của thiết bị khác. Hoàn tác hay quay về thời điểm cũ cũng chỉ ghi thêm thao tác mới — lịch sử phía sau vẫn còn nguyên.
      </p>
      {groups === null ? (
        <div className="text-xs text-muted-foreground">{loading ? "Đang tải…" : "Chưa tải nhật ký."}</div>
      ) : groups.length === 0 ? (
        <div className="text-xs text-muted-foreground">Chưa có thay đổi nào.</div>
      ) : (
        <div className="max-h-96 space-y-1.5 overflow-y-auto pr-1">
          {visible.map((group) => {
            const key = groupKey(group)
            const details = describeGroupDetails(group)
            const isBusy = busy === key
            return (
              <div key={key} className="rounded-md border bg-background px-3 py-2 text-xs">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-foreground">{describeGroupTitle(group)}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-muted-foreground">
                      <span>{formatDateTime(group.at)}</span>
                      <span>·</span>
                      <span>{group.mine ? "Máy này" : group.deviceLabel ?? "Thiết bị khác"}</span>
                      {group.firstSeq ? <span className="font-mono">#{group.firstSeq}</span> : null}
                      {group.pending ? <Badge variant="outline" className="h-5 px-1.5 text-[10px]">Chưa gửi</Badge> : null}
                    </div>
                    {details.length > 0 ? (
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-muted-foreground">
                        {details.map((line, index) => (
                          <li key={index} className="truncate">
                            {line}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 px-2" disabled={isBusy}>
                          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
                          Hoàn tác
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Hoàn tác thao tác này?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Các mục mà thao tác “{describeGroupTitle(group)}” đã đụng tới sẽ được đưa về đúng giá trị ngay trước nó, trên mọi thiết bị. Thao tác hoàn tác cũng được ghi vào nhật ký nên có thể hoàn tác lại.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Huỷ</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void undo(group)}>Hoàn tác</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" className="h-7 px-2" disabled={isBusy} title="Đưa toàn bộ dữ liệu về trạng thái ngay trước thao tác này">
                          <RotateCcw className="h-3.5 w-3.5" />
                          Quay về trước đây
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Đưa TOÀN BỘ dữ liệu về trước thời điểm này?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Dữ liệu trên mọi thiết bị sẽ trở về đúng trạng thái ngay trước “{describeGroupTitle(group)}” ({formatDateTime(group.at)}). Mọi thay đổi sau đó vẫn nằm trong nhật ký — bạn có thể quay lại bất cứ lúc nào.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Huỷ</AlertDialogCancel>
                          <AlertDialogAction onClick={() => void restore(group)}>Quay về thời điểm này</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              </div>
            )
          })}
          {groups.length > visible.length ? (
            <Button variant="ghost" size="sm" className="h-8 w-full" onClick={() => setLimit((n) => n + 40)}>
              Xem thêm ({groups.length - visible.length})
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}
