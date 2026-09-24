import { readTaskEvents } from "./task-events"
import {
  createLocusClient,
  readEntityIds,
  type components,
  type BackendContext,
  type LocusClient,
} from "@locus/client"

export type Wire<K extends keyof components["schemas"]> = components["schemas"][K]
export class ApiFailure extends Error {
  constructor(
    public readonly detail: Wire<"ApiError">,
    public readonly status: number,
  ) {
    super(detail.message)
  }
}
function result<T>(value: { data?: T; error?: Wire<"ApiError">; response: Response }): T {
  if (value.error) throw new ApiFailure(value.error, value.response.status)
  if (value.data === undefined) throw new Error("The backend returned no result.")
  return value.data
}
export const errorText = (error: unknown) =>
  error instanceof ApiFailure && error.detail.diagnostic
    ? diagnosticText(error.detail.diagnostic)
    : error instanceof Error
      ? error.message
      : "The observation could not be completed."

export function diagnosticText(value: Wire<"DomainDiagnostic">): string {
  return `${value.owner}: ${diagnosticDetail(value)}`
}
export function commitUnknown(value: Wire<"DomainDiagnostic">): boolean {
  return diagnosticKind(value) === "commit_outcome_unknown"
}
function diagnosticKind(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return
  if ("diagnostic" in value) return diagnosticKind(value.diagnostic)
  if ("error" in value) return diagnosticKind(value.error)
  return "kind" in value && typeof value.kind === "string" ? value.kind : undefined
}
function diagnosticDetail(value: unknown): string {
  if (!value || typeof value !== "object") return "Observation failed"
  if (
    "version" in value &&
    "code" in value &&
    (value.code === "payload_version" || value.code === "schema_version")
  )
    return `Unsupported ${value.code === "payload_version" ? "payload" : "schema"} version ${value.version}`
  if ("diagnostic" in value) return diagnosticDetail(value.diagnostic)
  if ("error" in value) return diagnosticDetail(value.error)
  if ("failure" in value) return diagnosticDetail(value.failure)
  const message = "message" in value ? value.message : "detail" in value ? value.detail : undefined
  const code = "kind" in value ? value.kind : "code" in value ? value.code : undefined
  return typeof message === "string"
    ? `${message}${typeof code === "string" ? ` (${code})` : ""}`
    : typeof code === "string"
      ? code.replaceAll("_", " ")
      : "Observation failed"
}

export class BackendApi {
  async savedPreview(kind: Wire<"MediaKind">, component_id: string) {
    return result(
      await this.client.GET("/api/v1/media/{kind}/{component_id}/saved-preview", {
        params: { path: { kind, component_id } },
      }),
    )
  }
  async bilibili(component_id: string) {
    return result(
      await this.client.GET("/api/v1/bilibili/{component_id}/view", {
        params: { path: { component_id } },
      }),
    )
  }
  async civitai(component_id: string) {
    return result(
      await this.client.GET("/api/v1/civitai/{component_id}/view", { params: { path: { component_id } } }),
    )
  }
  async civitaiPage(component_id: string) {
    return result(
      await this.client.GET("/api/v1/civitai/{component_id}/page", { params: { path: { component_id } } }),
    )
  }
  async civitaiVersion(component_id: string, version: string, source?: string) {
    return result(
      await this.client.GET("/api/v1/civitai/{component_id}/version", {
        params: { path: { component_id }, query: { version, source } },
      }),
    )
  }
  async civitaiOperations() {
    return result(await this.client.GET("/api/v1/civitai-operations"))
  }
  async enrichCivitai(body: Wire<"CivitaiRequest">) {
    return result(await this.client.POST("/api/v1/civitai-operations", { body }))
  }
  async externalRuntime() {
    return result(await this.client.GET("/api/v1/external-access/runtime"))
  }
  async externalToken() {
    return result(await this.client.GET("/api/v1/external-access/token"))
  }
  async resetExternalToken(body: Wire<"ResetToken">) {
    return result(await this.client.POST("/api/v1/external-access/token/reset", { body }))
  }
  readonly client: LocusClient
  constructor(
    readonly context: BackendContext,
    transport?: typeof fetch,
  ) {
    this.client = createLocusClient(context, transport)
  }
  async settingsDefinitions() {
    return result(await this.client.GET("/api/v1/settings/definitions"))
  }
  async settingsRead(group_id: string) {
    return result(
      await this.client.GET("/api/v1/settings/groups/{group_id}", { params: { path: { group_id } } }),
    )
  }
  async settingsChange(group_id: string, body: Wire<"ChangeSettings">) {
    return result(
      await this.client.POST("/api/v1/settings/groups/{group_id}", { params: { path: { group_id } }, body }),
    )
  }
  async mediaRuntime() {
    return result(await this.client.GET("/api/v1/settings/media-runtime"))
  }
  async importBatch(body: Wire<"BatchImportRequest">) {
    return result(await this.client.POST("/api/v1/import-batches", { body }))
  }
  async recoverImport(body: Wire<"ImportRecoveryRequest">) {
    return result(await this.client.POST("/api/v1/import-recoveries", { body }))
  }
  async imports() {
    return result(await this.client.GET("/api/v1/import-batches"))
  }
  async tasks() {
    return result(await this.client.GET("/api/v1/tasks"))
  }
  async taskOutcome(id: string) {
    return result(
      await this.client.GET("/api/v1/tasks/{task_id}/outcome", { params: { path: { task_id: id } } }),
    )
  }
  async taskEvents(signal: AbortSignal, receive: (snapshot: Wire<"TaskSnapshot">) => void) {
    const response = await this.client.GET("/api/v1/events", { parseAs: "stream", signal })
    const stream = result(response)
    if (!stream) throw new Error("Task stream unavailable")
    await readTaskEvents(stream, signal, receive)
  }

  async previewBytes(locator: string, signal: AbortSignal) {
    return result(
      await this.client.GET("/api/v1/previews/{locator}/bytes", {
        params: { path: { locator } },
        parseAs: "blob",
        signal,
      }),
    )
  }
  identities() {
    return readEntityIds(this.client)
  }
  async memberships(ids: string[]) {
    return result(await this.client.POST("/api/v1/memberships/read", { body: { entity_ids: ids } }))
  }
  async file(id: string) {
    return result(await this.client.GET("/api/v1/files/{file_id}", { params: { path: { file_id: id } } }))
  }
  async media(kind: Wire<"MediaKind">, id: string) {
    return result(
      await this.client.GET("/api/v1/media/{kind}/{component_id}/view", {
        params: { path: { kind, component_id: id } },
      }),
    )
  }
  async model(id: string) {
    return result(
      await this.client.GET("/api/v1/models/{component_id}/view", { params: { path: { component_id: id } } }),
    )
  }
  async twitter(id: string) {
    return result(
      await this.client.GET("/api/v1/twitter/{component_id}/view", {
        params: { path: { component_id: id } },
      }),
    )
  }
  async preferences(ids: string[]) {
    return result(
      await this.client.POST("/api/v1/entities/view-preferences/batch", { body: { entity_ids: ids } }),
    )
  }
  async savePreference(id: string, body: Wire<"UpdateViewPreference">) {
    return result(
      await this.client.PUT("/api/v1/entities/{entity_id}/view-preference", {
        params: { path: { entity_id: id } },
        body,
      }),
    )
  }
  async submission(id: string) {
    return result(
      await this.client.GET("/api/v1/requests/{request_id}", { params: { path: { request_id: id } } }),
    )
  }
  originalUrl(id: string) {
    // Host injects authorization/run headers for this exact origin, including
    // media-element range requests. No credential or managed path enters a URL.
    return new URL(`/api/v1/files/${encodeURIComponent(id)}/bytes`, this.context.origin).href
  }
  async bytes(id: string, signal: AbortSignal) {
    const value = await this.client.GET("/api/v1/files/{file_id}/bytes", {
      params: { path: { file_id: id } },
      parseAs: "blob",
      signal,
    })
    // openapi-fetch bypasses parsing for a zero Content-Length. Empty admitted
    // bytes are still an actual successful access; image decoding owns rejection.
    if (!value.error && value.response.status === 200 && value.response.headers.get("content-length") === "0")
      return new Blob([])
    return result(value)
  }
}
