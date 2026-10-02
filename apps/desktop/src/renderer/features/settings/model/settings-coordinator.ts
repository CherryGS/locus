import type { SettingsReadiness } from "../../../../shared/desktop-bridge"
import { createMediaToolPathsDefaults, MediaToolPathsGroupId, type MediaToolPaths } from "@locus/client"
import {
  ApiFailure,
  commitUnknown,
  diagnosticText,
  errorText,
  type BackendApi,
  type Wire,
} from "@/shared/api"

type Api = Pick<
  BackendApi,
  "settingsDefinitions" | "settingsRead" | "settingsChange" | "mediaRuntime" | "submission"
>
type Attempt = { body: Wire<"ChangeSettings">; generation: number }
function typed(value: unknown): MediaToolPaths {
  if (
    !value ||
    typeof value !== "object" ||
    !("ffprobe" in value) ||
    !("ffmpeg" in value) ||
    typeof value.ffprobe !== "string" ||
    typeof value.ffmpeg !== "string"
  )
    throw new Error("Media settings have an invalid value shape.")
  return { ffprobe: value.ffprobe, ffmpeg: value.ffmpeg }
}
/** One run, one group. Observations, edits and submitted execution have independent identities. */
export type GroupConfiguration<Value, Runtime> = {
  groupId: string
  defaults: Value
  typed: (value: unknown) => Value
  runtime: () => Promise<Runtime>
}
export class SettingsCoordinator<
  Value extends object = MediaToolPaths,
  Runtime = Wire<"MediaRuntimeObservation">,
> {
  observation?: Wire<"SettingsObservation">
  runtime?: Runtime
  definition?: Wire<"SettingsDefinition">
  draft?: Value
  generation = 0
  dirty = false
  conflict = false
  readPending = false
  definitionError?: string
  readError?: string
  runtimeError?: string
  problem?: string
  status: "idle" | "saving" | "saved" | "failed" | "uncertain" = "idle"
  attempt?: Attempt
  needsEvidence = false
  private version = 0
  private loadTicket = 0
  private readTicket = 0
  private basis = 0
  private work?: Promise<void>
  private sealed = false
  private live = true
  private listeners = new Set<() => void>()
  readonly configuration: GroupConfiguration<Value, Runtime>
  get defaults() {
    return this.configuration.defaults
  }
  constructor(
    private api: Api,
    private uuid = () => crypto.randomUUID(),
    configuration?: GroupConfiguration<Value, Runtime>
  ) {
    this.configuration = configuration ?? {
      groupId: MediaToolPathsGroupId,
      defaults: createMediaToolPathsDefaults() as unknown as Value,
      typed: typed as unknown as (value: unknown) => Value,
      runtime: () => api.mediaRuntime() as Promise<Runtime>,
    }
  }
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  readonly snapshot = () => this.version
  private changed() {
    this.version++
    for (const listener of this.listeners) listener()
  }
  get editable() {
    return (
      this.live && !this.sealed && !this.conflict && this.observation?.status === "current" && !!this.draft
    )
  }
  get busy() {
    return !!this.work
  }
  get resetRevision() {
    const observation = this.observation
    if (!this.definition || this.definitionError || this.readError || !observation) return undefined
    if (observation.status === "current") return observation.saved.metadata.revision
    if (
      observation.status === "invalid" ||
      observation.status === "unsupported"
    )
      return observation.metadata.revision
    // The server reports independently validated revision metadata even when the version is corrupt.
    if (observation.status === "corrupt") return observation.revision ?? undefined
    return undefined
  }
  get canSave() {
    return (
      this.editable &&
      this.dirty &&
      !this.readError &&
      !this.attempt &&
      !this.needsEvidence &&
      !this.work &&
      this.status !== "failed"
    )
  }
  async load() {
    if (!this.live || this.sealed) return
    const ticket = ++this.loadTicket
    await Promise.allSettled([
      this.read(),
      (async () => {
        try {
          const definitions = await this.api.settingsDefinitions()
          if (this.live && ticket === this.loadTicket) {
            this.definition = definitions.find((x) => x.group_id === this.configuration.groupId)
            this.definitionError = this.definition ? undefined : "Settings definition is unavailable."
          }
        } catch (error) {
          if (this.live && ticket === this.loadTicket) this.definitionError = errorText(error)
        }
        this.changed()
      })(),
      (async () => {
        try {
          const runtime = await this.configuration.runtime()
          if (this.live && ticket === this.loadTicket) {
            this.runtime = runtime
            this.runtimeError = undefined
          }
        } catch (error) {
          if (this.live && ticket === this.loadTicket) this.runtimeError = errorText(error)
        }
        this.changed()
      })(),
    ])
  }
  async read() {
    if (!this.live || this.sealed || this.work || this.attempt) return
    const ticket = ++this.readTicket,
      generation = this.generation,
      basis = this.basis
    this.readPending = true
    this.changed()
    try {
      const observation = await this.api.settingsRead(this.configuration.groupId)
      if (!this.live || ticket !== this.readTicket || basis !== this.basis) return
      const previousRevision =
        this.observation?.status === "current" ? this.observation.saved.metadata.revision : undefined
      this.accept(observation)
      if (
        this.dirty &&
        observation.status === "current" &&
        previousRevision !== observation.saved.metadata.revision
      ) {
        this.conflict = true
        this.status = "failed"
        this.problem =
          "Saved settings changed. Review the current saved values and discard this edit before editing again."
      }
      this.readError = undefined
      if (!this.dirty && generation === this.generation && observation.status === "current")
        this.draft = this.configuration.typed(observation.saved.value)
      if (this.needsEvidence) {
        this.needsEvidence = false
        this.status = "failed"
        this.problem =
          "Execution has ended and current saved state is observed. Discard the edit before editing again."
      }
    } catch (error) {
      if (ticket === this.readTicket && basis === this.basis) this.readError = errorText(error)
    } finally {
      if (ticket === this.readTicket) this.readPending = false
      this.changed()
    }
  }
  private accept(observation: Wire<"SettingsObservation">) {
    const id = observation.status === "current" ? observation.saved.group_id : observation.group_id
    if (id !== this.configuration.groupId) throw new Error("Settings observation named another group.")
    if (observation.status === "current") this.configuration.typed(observation.saved.value)
    this.observation = observation
    this.basis++
  }
  edit(field: keyof Value, value: string) {
    if (!this.editable || !this.draft) return false
    this.draft = { ...this.draft, [field]: value }
    this.generation++
    this.dirty = true
    this.changed()
    return true
  }
  discard() {
    if (
      !this.live ||
      this.sealed ||
      this.work ||
      this.attempt ||
      this.needsEvidence ||
      this.observation?.status !== "current"
    )
      return false
    this.draft = this.configuration.typed(this.observation.saved.value)
    this.dirty = false
    this.conflict = false
    this.status = "idle"
    this.problem = undefined
    this.generation++
    this.changed()
    return true
  }
  save() {
    if (!this.canSave || this.observation?.status !== "current" || !this.draft) return Promise.resolve()
    return this.submit({
      operation: "update",
      expected_revision: this.observation.saved.metadata.revision,
      value: { ...this.draft },
    })
  }
  reset() {
    const expected_revision = this.resetRevision
    if (!this.live || this.sealed || !expected_revision || this.work || this.attempt || this.needsEvidence)
      return Promise.resolve()
    return this.submit({ operation: "reset", expected_revision })
  }
  private submit(change: Wire<"SettingsChange">) {
    const attempt = { body: { request_id: this.uuid(), change }, generation: this.generation }
    this.attempt = attempt
    this.status = "saving"
    this.problem = undefined
    return this.run(async () => {
      try {
        this.complete(attempt, await this.api.settingsChange(this.configuration.groupId, attempt.body))
      } catch (error) {
        if (!this.live) return
        if (error instanceof ApiFailure && error.detail.code === "wrong_run") {
          this.lost("The backend run changed. Start a fresh application session.")
          return
        }
        if (error instanceof ApiFailure && error.detail.code !== "operation_failed") {
          this.attempt = undefined
          this.status = "failed"
          this.problem = errorText(error)
        } else {
          this.status = "uncertain"
          this.problem = `Save confirmation unavailable: ${errorText(error)}`
        }
      }
    })
  }
  private run(operation: () => Promise<void>) {
    this.work = Promise.resolve()
      .then(operation)
      .finally(() => {
        this.work = undefined
        this.changed()
      })
    this.changed()
    return this.work
  }
  private complete(attempt: Attempt, outcome: Wire<"MutationOutcome">) {
    if (!this.live || this.attempt !== attempt) return
    if (outcome.status === "settings_saved") {
      this.accept({ status: "current", saved: outcome.saved })
      this.readTicket++
      this.readPending = false
      this.readError = undefined
      this.attempt = undefined
      this.status = "saved"
      this.problem = undefined
      if (this.generation === attempt.generation) {
        this.draft = this.configuration.typed(outcome.saved.value)
        this.dirty = false
      }
    } else if (outcome.status === "settings_conflict" || outcome.status === "settings_existing") {
      this.accept(outcome.current)
      this.attempt = undefined
      this.conflict = true
      this.status = "failed"
      this.problem =
        "Saved settings changed. Review the current saved values and discard this edit before editing again."
    } else if (outcome.status === "failed") {
      this.attempt = undefined
      this.needsEvidence = commitUnknown(outcome.diagnostic)
      this.status = this.needsEvidence ? "uncertain" : "failed"
      this.problem = diagnosticText(outcome.diagnostic)
    } else {
      this.status = "uncertain"
      this.problem = "Unexpected save response; recover the original request."
    }
  }
  async recover() {
    if (!this.live || this.sealed || this.work) return
    if (!this.attempt) {
      await this.read()
      return
    }
    const attempt = this.attempt
    await this.run(async () => {
      try {
        const result = await this.api.submission(attempt.body.request_id)
        if (!this.live || this.attempt !== attempt) return
        if (result.status === "direct_complete") this.complete(attempt, result.outcome)
        else if (result.status === "rejected") {
          this.attempt = undefined
          this.status = "failed"
          this.problem = result.error.message
        } else {
          this.status = "uncertain"
          this.problem = "Original save is still running. Check its confirmation again."
        }
      } catch (error) {
        if (!this.live || this.attempt !== attempt) return
        if (error instanceof ApiFailure && error.detail.code === "unknown_request") {
          try {
            this.complete(attempt, await this.api.settingsChange(this.configuration.groupId, attempt.body))
          } catch (failure) {
            this.problem = errorText(failure)
            this.status = "uncertain"
          }
        } else {
          this.problem = errorText(error)
          this.status = "uncertain"
        }
      }
    })
  }
  async prepare(): Promise<SettingsReadiness> {
    if (this.work) await this.work
    return this.preparation()
  }
  preparation(): SettingsReadiness {
    return {
      revision: this.generation,
      draft: this.dirty,
      blocked: !this.live
        ? "Backend unavailable"
        : this.work ||
            this.attempt ||
            this.needsEvidence ||
            this.status === "failed" ||
            this.status === "uncertain"
          ? (this.problem ?? "Settings save is unresolved")
          : undefined,
    }
  }
  canSeal(revision: number, discard: boolean, restart: boolean) {
    const state = this.preparation()
    return revision === this.generation && (!restart || (!state.blocked && (!state.draft || discard)))
  }
  seal(revision: number, discard: boolean, restart: boolean) {
    if (!this.canSeal(revision, discard, restart)) return false
    // Consent is scoped to this generation; retained draft data never becomes a saved claim.
    this.sealed = true
    return true
  }
  returnToApplication() {
    this.sealed = false
    this.changed()
  }
  lost(message: string) {
    this.live = false
    this.loadTicket++
    this.problem = message
    this.runtime = undefined
    this.runtimeError = message
    this.changed()
  }
}
