import { nanoid } from "nanoid"
import { OP_SCHEMA_VERSION, type LedgerOp, type OpDraft } from "@/ledger/ops"
import { emptyLedgerState, type LedgerState } from "@/ledger/records"
import type { SyncDoc } from "@/sync/snapshot"

/**
 * Nhật ký cục bộ của thiết bị (IndexedDB, dùng chung mọi tab cùng trình duyệt):
 *  - meta: danh tính thiết bị, bộ đếm cseq, con trỏ server đã phát lại
 *  - confirmed: trạng thái đã phát lại tới `cursor` — CACHE dựng lại được từ server, không phải bản sao lưu
 *  - outbox: op chưa được server xác nhận
 *
 * Mọi thay đổi đi trong transaction ⇒ hai tab không thể cấp trùng cseq hay ghi đè nhau.
 */

export const JOURNAL_DB_NAME = "myfinance-ledger"
const DB_VERSION = 1
const KV_STORE = "kv"
const OUTBOX_STORE = "outbox"

export type JoinInfo = {
  /** Điểm đồng bộ chung cuối cùng với Sync v3 (để gộp 3 chiều khi lên sổ cái). null = không tin được. */
  v3Base: SyncDoc | null
  v3BaseVersion: number
  v3Genesis?: string
  /** Tombstone v3 của máy này (id trần / `cat:<id>`) — thể hiện lệnh xoá chưa kịp đồng bộ. */
  legacyTombstones: Record<string, string>
  legacyTemplateTombstones: Record<string, string>
  /** Máy này đang là máy chuyển đổi dữ liệu v3 lên sổ cái (outbox đang là bộ genesis). */
  migrating?: boolean
  /** Version cuối của v3 lúc đóng băng và genesis v3 trên Redis — ghi vào bản ghi chuyển đổi. */
  v3Final?: number
  v3RemoteGenesis?: string
}

export type JournalMeta = {
  schema: 1
  deviceId: string
  deviceLabel: string
  /** cseq sẽ cấp cho op kế tiếp. */
  nextCseq: number
  /** cseq lớn nhất của máy này đã nằm trong `confirmed`. */
  ackedCseq: number
  /** seq cuối cùng của sổ cái server đã phát lại vào `confirmed`. */
  cursor: number
  genesisId?: string
  /** Khác null khi máy này chưa gia nhập sổ cái trên server (lần đầu chạy v4, hoặc mới bật Upstash). */
  join: JoinInfo | null
  /** Dấu vân tay `cttm_v1`/mẫu của bản cũ lần cuối đã nhập — để nhận dữ liệu do tab bản cũ ghi thêm. */
  legacyHash?: string
  legacyImportedAt?: string
  createdAt: number
}

export type JournalSnapshot = {
  meta: JournalMeta
  confirmed: LedgerState
  outbox: LedgerOp[]
}

export interface Journal {
  readonly kind: "indexeddb" | "memory"
  load(): Promise<JournalSnapshot | null>
  /** Khởi tạo nếu còn trống. Nếu tab khác đã khởi tạo trước thì trả về bản đó, không ghi đè. */
  initialize(snapshot: JournalSnapshot): Promise<JournalSnapshot>
  /** Cấp cseq và ghi op vào outbox trong cùng một transaction. */
  append(drafts: OpDraft[], tx: string, at: string): Promise<LedgerOp[]>
  /**
   * Ghi kết quả phát lại op từ server. Thất bại (trả false) nếu cursor trên đĩa đã khác
   * `expectedCursor` (tab khác vừa làm) — caller tải lại rồi thử lại.
   */
  commitPull(input: { expectedCursor: number; cursor: number; confirmed: LedgerState; ackedCseq: number }): Promise<boolean>
  /**
   * Thay toàn bộ outbox bằng bộ op mới (chỉ dùng cho op CHƯA từng lên server: gia nhập sổ cái,
   * khởi tạo lại). Trả null nếu outbox đã đổi kể từ khi caller tính toán (`expectedNextCseq` lệch):
   * khi đó có tab khác vừa ghi thêm — caller tính lại, không bao giờ làm mất op đó.
   */
  replace(input: { expectedNextCseq: number; meta: Partial<JournalMeta>; outbox: LedgerOp[]; confirmed?: LedgerState }): Promise<JournalSnapshot | null>
  /** Đánh số lại toàn bộ outbox (đổi danh tính thiết bị / lấp khoảng hở cseq) trong MỘT transaction. */
  renumberOutbox(input: { deviceId: string; firstCseq: number; ackedCseq: number }): Promise<JournalSnapshot>
  patchMeta(patch: Partial<JournalMeta>): Promise<JournalMeta>
  readOutbox(): Promise<LedgerOp[]>
}

export function makeOp(draft: OpDraft, meta: Pick<JournalMeta, "deviceId" | "deviceLabel">, cseq: number, tx: string, at: string): LedgerOp {
  const op: LedgerOp = {
    sv: OP_SCHEMA_VERSION,
    id: nanoid(12),
    dev: meta.deviceId,
    dl: meta.deviceLabel,
    cseq,
    at,
    tx,
    t: draft.t,
    key: draft.key,
  }
  if (draft.v) op.v = draft.v
  if (draft.u && draft.u.length > 0) op.u = draft.u
  return op
}

/** Đánh số lại các op chưa lên server cho một danh tính/điểm bắt đầu mới. */
export function renumberOps(ops: LedgerOp[], meta: Pick<JournalMeta, "deviceId" | "deviceLabel">, firstCseq: number): LedgerOp[] {
  return ops.map((op, index) => ({ ...op, id: nanoid(12), dev: meta.deviceId, dl: meta.deviceLabel, cseq: firstCseq + index }))
}

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"))
  })
}

function completion(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"))
    tx.onabort = () => reject(tx.error ?? new DOMException("Transaction aborted", "AbortError"))
  })
}

class AbortSignalled extends Error {}

export class IndexedDbJournal implements Journal {
  readonly kind = "indexeddb" as const
  private dbPromise: Promise<IDBDatabase> | null = null

  constructor(
    private readonly factory: IDBFactory,
    private readonly name = JOURNAL_DB_NAME,
  ) {}

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        const open = this.factory.open(this.name, DB_VERSION)
        open.onupgradeneeded = () => {
          const db = open.result
          if (!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE)
          if (!db.objectStoreNames.contains(OUTBOX_STORE)) db.createObjectStore(OUTBOX_STORE, { keyPath: "cseq" })
        }
        open.onsuccess = () => {
          const db = open.result
          db.onversionchange = () => db.close()
          resolve(db)
        }
        open.onerror = () => reject(open.error ?? new Error("Không mở được IndexedDB"))
        open.onblocked = () => reject(new Error("IndexedDB đang bị một tab khác khoá"))
      })
      this.dbPromise.catch(() => {
        this.dbPromise = null
      })
    }
    return this.dbPromise
  }

  /** Chạy fn trong một transaction; fn ném AbortSignalled ⇒ huỷ transaction và trả về null. */
  private async run<T>(mode: IDBTransactionMode, fn: (kv: IDBObjectStore, outbox: IDBObjectStore) => Promise<T>): Promise<T | null> {
    const db = await this.db()
    const tx = db.transaction([KV_STORE, OUTBOX_STORE], mode)
    const finished = completion(tx)
    let result: T
    try {
      result = await fn(tx.objectStore(KV_STORE), tx.objectStore(OUTBOX_STORE))
    } catch (error) {
      try {
        tx.abort()
      } catch {
        // đã kết thúc
      }
      await finished.catch(() => undefined)
      if (error instanceof AbortSignalled) return null
      throw error
    }
    await finished
    return result
  }

  async load(): Promise<JournalSnapshot | null> {
    return this.run("readonly", async (kv, outbox) => {
      const meta = (await request(kv.get("meta"))) as JournalMeta | undefined
      if (!meta) return null
      const confirmed = ((await request(kv.get("confirmed"))) as LedgerState | undefined) ?? emptyLedgerState()
      const ops = (await request(outbox.getAll())) as LedgerOp[]
      return { meta, confirmed, outbox: ops.sort((a, b) => a.cseq - b.cseq) }
    })
  }

  async initialize(snapshot: JournalSnapshot): Promise<JournalSnapshot> {
    const result = await this.run("readwrite", async (kv, outbox) => {
      const existing = (await request(kv.get("meta"))) as JournalMeta | undefined
      if (existing) {
        const confirmed = ((await request(kv.get("confirmed"))) as LedgerState | undefined) ?? emptyLedgerState()
        const ops = (await request(outbox.getAll())) as LedgerOp[]
        return { meta: existing, confirmed, outbox: ops.sort((a, b) => a.cseq - b.cseq) }
      }
      kv.put(snapshot.meta, "meta")
      kv.put(snapshot.confirmed, "confirmed")
      for (const op of snapshot.outbox) outbox.put(op)
      return snapshot
    })
    return result as JournalSnapshot
  }

  async append(drafts: OpDraft[], txId: string, at: string): Promise<LedgerOp[]> {
    if (drafts.length === 0) return []
    const result = await this.run("readwrite", async (kv, outbox) => {
      const meta = (await request(kv.get("meta"))) as JournalMeta | undefined
      if (!meta) throw new Error("Nhật ký cục bộ chưa được khởi tạo.")
      const ops: LedgerOp[] = []
      let cseq = meta.nextCseq
      for (const draft of drafts) {
        const op = makeOp(draft, meta, cseq, txId, at)
        cseq += 1
        outbox.put(op)
        ops.push(op)
      }
      kv.put({ ...meta, nextCseq: cseq }, "meta")
      return ops
    })
    return result ?? []
  }

  async commitPull(input: { expectedCursor: number; cursor: number; confirmed: LedgerState; ackedCseq: number }): Promise<boolean> {
    const result = await this.run("readwrite", async (kv, outbox) => {
      const meta = (await request(kv.get("meta"))) as JournalMeta | undefined
      if (!meta || meta.cursor !== input.expectedCursor) throw new AbortSignalled()
      const acked = Math.max(meta.ackedCseq, input.ackedCseq)
      kv.put(input.confirmed, "confirmed")
      kv.put({ ...meta, cursor: input.cursor, ackedCseq: acked }, "meta")
      if (acked > 0) {
        // Không dùng IDBKeyRange toàn cục để chạy được với mọi IDBFactory được tiêm vào.
        const keys = (await request(outbox.getAllKeys())) as number[]
        for (const key of keys) if (key <= acked) outbox.delete(key)
      }
      return true
    })
    return result === true
  }

  async replace(input: { expectedNextCseq: number; meta: Partial<JournalMeta>; outbox: LedgerOp[]; confirmed?: LedgerState }): Promise<JournalSnapshot | null> {
    return this.run("readwrite", async (kv, outbox) => {
      const meta = (await request(kv.get("meta"))) as JournalMeta | undefined
      if (!meta) throw new Error("Nhật ký cục bộ chưa được khởi tạo.")
      if (meta.nextCseq !== input.expectedNextCseq) throw new AbortSignalled()
      const nextMeta: JournalMeta = { ...meta, ...input.meta }
      await request(outbox.clear())
      for (const op of input.outbox) outbox.put(op)
      kv.put(nextMeta, "meta")
      let confirmed = input.confirmed
      if (confirmed) kv.put(confirmed, "confirmed")
      else confirmed = ((await request(kv.get("confirmed"))) as LedgerState | undefined) ?? emptyLedgerState()
      return { meta: nextMeta, confirmed, outbox: [...input.outbox].sort((a, b) => a.cseq - b.cseq) }
    })
  }

  async renumberOutbox(input: { deviceId: string; firstCseq: number; ackedCseq: number }): Promise<JournalSnapshot> {
    const result = await this.run("readwrite", async (kv, outbox) => {
      const meta = (await request(kv.get("meta"))) as JournalMeta | undefined
      if (!meta) throw new Error("Nhật ký cục bộ chưa được khởi tạo.")
      const current = ((await request(outbox.getAll())) as LedgerOp[]).sort((a, b) => a.cseq - b.cseq)
      const nextMeta: JournalMeta = { ...meta, deviceId: input.deviceId, ackedCseq: input.ackedCseq, nextCseq: input.firstCseq + current.length }
      const ops = renumberOps(current, nextMeta, input.firstCseq)
      await request(outbox.clear())
      for (const op of ops) outbox.put(op)
      kv.put(nextMeta, "meta")
      const confirmed = ((await request(kv.get("confirmed"))) as LedgerState | undefined) ?? emptyLedgerState()
      return { meta: nextMeta, confirmed, outbox: ops }
    })
    return result as JournalSnapshot
  }

  async patchMeta(patch: Partial<JournalMeta>): Promise<JournalMeta> {
    const result = await this.run("readwrite", async (kv) => {
      const meta = (await request(kv.get("meta"))) as JournalMeta | undefined
      if (!meta) throw new Error("Nhật ký cục bộ chưa được khởi tạo.")
      const next = { ...meta, ...patch }
      kv.put(next, "meta")
      return next
    })
    return result as JournalMeta
  }

  async readOutbox(): Promise<LedgerOp[]> {
    const result = await this.run("readonly", async (_kv, outbox) => (await request(outbox.getAll())) as LedgerOp[])
    return (result ?? []).sort((a, b) => a.cseq - b.cseq)
  }
}

// ---------------------------------------------------------------------------
// Bộ nhớ (dự phòng khi trình duyệt chặn IndexedDB; dữ liệu chỉ an toàn sau khi đã đẩy lên server)
// ---------------------------------------------------------------------------

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

export class MemoryJournal implements Journal {
  readonly kind = "memory" as const
  private snapshot: JournalSnapshot | null = null

  async load() {
    return this.snapshot ? clone(this.snapshot) : null
  }

  async initialize(snapshot: JournalSnapshot) {
    if (!this.snapshot) this.snapshot = clone(snapshot)
    return clone(this.snapshot)
  }

  async append(drafts: OpDraft[], tx: string, at: string) {
    if (!this.snapshot) throw new Error("Nhật ký cục bộ chưa được khởi tạo.")
    const ops: LedgerOp[] = []
    for (const draft of drafts) {
      const op = makeOp(draft, this.snapshot.meta, this.snapshot.meta.nextCseq, tx, at)
      this.snapshot.meta.nextCseq += 1
      this.snapshot.outbox.push(clone(op))
      ops.push(op)
    }
    return ops
  }

  async commitPull(input: { expectedCursor: number; cursor: number; confirmed: LedgerState; ackedCseq: number }) {
    if (!this.snapshot || this.snapshot.meta.cursor !== input.expectedCursor) return false
    const acked = Math.max(this.snapshot.meta.ackedCseq, input.ackedCseq)
    this.snapshot.confirmed = clone(input.confirmed)
    this.snapshot.meta = { ...this.snapshot.meta, cursor: input.cursor, ackedCseq: acked }
    this.snapshot.outbox = this.snapshot.outbox.filter((op) => op.cseq > acked)
    return true
  }

  async replace(input: { expectedNextCseq: number; meta: Partial<JournalMeta>; outbox: LedgerOp[]; confirmed?: LedgerState }) {
    if (!this.snapshot) throw new Error("Nhật ký cục bộ chưa được khởi tạo.")
    if (this.snapshot.meta.nextCseq !== input.expectedNextCseq) return null
    this.snapshot = {
      meta: { ...this.snapshot.meta, ...clone(input.meta) },
      confirmed: input.confirmed ? clone(input.confirmed) : this.snapshot.confirmed,
      outbox: clone(input.outbox).sort((a, b) => a.cseq - b.cseq),
    }
    return clone(this.snapshot)
  }

  async renumberOutbox(input: { deviceId: string; firstCseq: number; ackedCseq: number }) {
    if (!this.snapshot) throw new Error("Nhật ký cục bộ chưa được khởi tạo.")
    const meta: JournalMeta = {
      ...this.snapshot.meta,
      deviceId: input.deviceId,
      ackedCseq: input.ackedCseq,
      nextCseq: input.firstCseq + this.snapshot.outbox.length,
    }
    this.snapshot = { ...this.snapshot, meta, outbox: renumberOps(this.snapshot.outbox, meta, input.firstCseq) }
    return clone(this.snapshot)
  }

  async patchMeta(patch: Partial<JournalMeta>) {
    if (!this.snapshot) throw new Error("Nhật ký cục bộ chưa được khởi tạo.")
    this.snapshot.meta = { ...this.snapshot.meta, ...clone(patch) }
    return clone(this.snapshot.meta)
  }

  async readOutbox() {
    return clone(this.snapshot?.outbox ?? [])
  }
}
