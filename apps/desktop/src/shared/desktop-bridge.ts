import type { components } from "@locus/client"
export type Availability = components["schemas"]["Availability"]
export type LifecycleIntent = "close" | "restart"
export type SettingsReadiness = { revision: number; draft: boolean; blocked?: string }
export type Connection =
  | { status: "starting" }
  | { status: "ready"; origin: string; runId: string; availability?: Availability }
  | { status: "failed" | "lost"; message: string }

export type UnconfirmedChoice = { entityId: string; viewId: string; reason: string }
export type CloseState =
  | { phase: "idle" }
  | { phase: "preparing"; attemptId: string; intent?: LifecycleIntent }
  | {
      phase: "unconfirmed"
      attemptId: string
      intent?: LifecycleIntent
      settings?: SettingsReadiness
      revision: number
      items: UnconfirmedChoice[]
    }
  | {
      phase: "sealing"
      attemptId: string
      intent?: LifecycleIntent
      settings?: SettingsReadiness
      revision: number
      continueExit: boolean
    }
  | { phase: "draining"; attemptId: string; intent?: LifecycleIntent; active?: string }

export type LibrarySource = {
  kind: "environment" | "startup" | "selection" | "path-file" | "default" | "preview"
  name?: string
}
export type DesktopState = {
  connection: Connection
  close: CloseState
  library?: { root: string; source?: LibrarySource; switchTarget?: string; notice?: string }
}
export type Preparation = {
  attemptId: string
  intent?: LifecycleIntent
  settings?: SettingsReadiness
  revision: number
  items: UnconfirmedChoice[]
}
export type CloseAction = {
  attemptId: string
  action: "return" | "continue"
  revision?: number
  settingsRevision?: number
}
export type CloseCommit = { attemptId: string; revision: number; settingsRevision?: number }

/** No credential, generic IPC, process or filesystem capability crosses this seam. */
export type LocalFileSelection =
  { status: "selected"; paths: string[] } | { status: "canceled" } | { status: "failed"; message: string }

export type ExternalLinkResult = { url: string; status: "handed_off" | "failed"; message?: string }

export interface DesktopBridge {
  switchLibrary(): Promise<
    { status: "switching" | "canceled" | "unchanged" } | { status: "failed"; message: string }
  >
  requestLifecycle(intent: LifecycleIntent): Promise<void>
  openExternalLink(url: string): Promise<ExternalLinkResult>
  selectImportFiles(): Promise<LocalFileSelection>
  state(): Promise<DesktopState>
  ready(): Promise<void>
  observe(listener: (state: DesktopState) => void): () => void
  prepared(result: Preparation): Promise<void>
  closeAction(action: CloseAction): Promise<void>
  commitClose(commit: CloseCommit): Promise<void>
}

export const desktopChannels = {
  switchLibrary: "locus:switch-library",
  lifecycle: "locus:lifecycle",
  openExternalLink: "locus:open-external-link",
  selectImportFiles: "locus:select-import-files",
  state: "locus:state",
  ready: "locus:renderer-ready",
  changed: "locus:changed",
  prepared: "locus:prepared",
  action: "locus:close-action",
  commit: "locus:close-commit",
} as const

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object"
const identity = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 256
const revision = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0
export function isPreparation(value: unknown): value is Preparation {
  return (
    record(value) &&
    identity(value.attemptId) &&
    revision(value.revision) &&
    (value.settings === undefined ||
      (record(value.settings) &&
        revision(value.settings.revision) &&
        typeof value.settings.draft === "boolean" &&
        (value.settings.blocked === undefined || typeof value.settings.blocked === "string"))) &&
    Array.isArray(value.items) &&
    value.items.every(
      (item) =>
        record(item) && identity(item.entityId) && identity(item.viewId) && typeof item.reason === "string",
    )
  )
}
export function isCloseAction(value: unknown): value is CloseAction {
  return (
    record(value) &&
    identity(value.attemptId) &&
    (value.action === "return" ||
      (value.action === "continue" &&
        revision(value.revision) &&
        (value.settingsRevision === undefined || revision(value.settingsRevision))))
  )
}
export function isCloseCommit(value: unknown): value is CloseCommit {
  return (
    record(value) &&
    identity(value.attemptId) &&
    revision(value.revision) &&
    (value.settingsRevision === undefined || revision(value.settingsRevision))
  )
}
