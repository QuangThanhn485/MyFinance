import { STORAGE_KEY } from "@/storage/schema"

export type WorkspaceId = "real" | "demo"

export const DEMO_STORAGE_KEY = `${STORAGE_KEY}_demo` as const
export const ACTIVE_WORKSPACE_KEY = "cttm_active_workspace_v1" as const

export function getStorageKeyForWorkspace(workspace: WorkspaceId): string {
  return workspace === "demo" ? DEMO_STORAGE_KEY : STORAGE_KEY
}

export function loadWorkspaceId(): WorkspaceId {
  const raw = localStorage.getItem(ACTIVE_WORKSPACE_KEY)
  return raw === "demo" ? "demo" : "real"
}

export function saveWorkspaceId(workspace: WorkspaceId) {
  localStorage.setItem(ACTIVE_WORKSPACE_KEY, workspace)
}

