import type { CttmState } from "@/storage/schema"
import type { WorkspaceId } from "@/storage/workspace"

export const LAST_BACKUP_STORAGE_KEY = "cttm_backup_last_v1" as const

export type BackupRecord = {
  at: string
  workspace: WorkspaceId
  reason: string
  data: CttmState
}

function nowIso() {
  return new Date().toISOString()
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function writeLastBackup(input: {
  workspace: WorkspaceId
  reason: string
  data: CttmState
}): BackupRecord {
  const record: BackupRecord = {
    at: nowIso(),
    workspace: input.workspace,
    reason: input.reason,
    data: input.data,
  }
  localStorage.setItem(LAST_BACKUP_STORAGE_KEY, JSON.stringify(record))
  return record
}

export function readLastBackup(): BackupRecord | null {
  const raw = localStorage.getItem(LAST_BACKUP_STORAGE_KEY)
  if (!raw) return null
  const parsed = safeParseJson(raw)
  if (!isRecord(parsed)) return null

  const at = typeof parsed.at === "string" ? parsed.at : ""
  const reason = typeof parsed.reason === "string" ? parsed.reason : ""
  const workspace =
    parsed.workspace === "demo" || parsed.workspace === "real"
      ? (parsed.workspace as WorkspaceId)
      : "real"
  const data = parsed.data as CttmState | undefined
  if (!data || typeof data !== "object") return null

  return { at, reason, workspace, data }
}

