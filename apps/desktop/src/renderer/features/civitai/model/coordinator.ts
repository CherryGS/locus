import { ApiFailure, errorText, type BackendApi, type Wire } from "@/shared/api"
import type { DesktopState } from "../../../../shared/desktop-bridge"
type Pending = { body: Wire<"CivitaiRequest">; sending: boolean; problem?: string; receipt?: Wire<"Receipt"> }
export class CivitaiCoordinator {
  operations: Wire<"CivitaiOperation">[] = []
  importOperations: Wire<"ImportItem">[] = []
  setImports(items: Wire<"ImportItem">[]) {
    this.importOperations = items
    this.changed()
  }
  newBlocked(entity: string) {
    return (
      this.blocked(entity) ||
      this.operations.some(
        (o) => o.outcome.entity_id === entity && (o.outcome.state === "uncertain" || o.unconfirmed_effects),
      ) ||
      this.importOperations.some(
        (i) =>
          i.current.entity_id === entity &&
          !!i.current.civitai &&
          (!!i.active_request_id || i.current.civitai.state === "uncertain"),
      )
    )
  }
  readonly pending = new Map<string, Pending>()
  problem?: string
  available = false
  projectionRevision = 0
  private revision = 0
  private live = true
  private reading = false
  private observeAgain = false
  private ended = false
  private runLost = false
  private timer?: ReturnType<typeof setTimeout>
  private effects = new Map<string, string>()
  private listeners = new Set<() => void>()
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  readonly snapshot = () => this.revision
  constructor(
    private api: BackendApi,
    private effectsChanged: (ids: string[]) => void,
  ) {}
  private changed() {
    this.revision++
    this.listeners.forEach((fn) => fn())
  }
  invalidate() {
    this.projectionRevision++
    this.changed()
  }
  host(state: DesktopState) {
    this.live =
      !this.ended &&
      !this.runLost &&
      state.connection.status === "ready" &&
      state.connection.runId === this.api.context.runId
    this.available = this.live && state.close.phase === "idle"
    if (!this.live) {
      clearTimeout(this.timer)
      this.problem = "Backend run unavailable. Saved observations do not authorize replay."
    }
    this.changed()
  }
  blocked(entity: string) {
    return (
      [...this.pending.values()].some((p) => p.body.entity_id === entity) ||
      this.operations.some((o) => o.outcome.entity_id === entity && !!o.active_request_id)
    )
  }
  async submit(entity: string, file: string, firstOnly: boolean, continuation?: string) {
    if (!this.available || (continuation ? this.blocked(entity) : this.newBlocked(entity))) return
    const body: Wire<"CivitaiRequest"> = {
      request_id: crypto.randomUUID(),
      entity_id: entity,
      file_id: file,
      first_only: firstOnly,
      continuation: continuation ?? null,
    }
    await this.send({ body, sending: true })
  }
  private receipt(pending: Pending, value: Wire<"Receipt">) {
    if (
      value.run_id !== this.api.context.runId ||
      value.request_id !== pending.body.request_id ||
      (pending.receipt && pending.receipt.task_id !== value.task_id)
    ) {
      this.problem = "Provider receipt attribution changed; this request will not be replayed"
      pending.problem = this.problem
      this.runLost = true
      this.live = false
      this.available = false
      throw new Error(this.problem)
    }
    pending.receipt = value
  }
  private async send(pending: Pending) {
    this.pending.set(pending.body.request_id, pending)
    pending.sending = true
    this.changed()
    try {
      const receipt = await this.api.enrichCivitai(pending.body)
      if (!this.live) return
      this.receipt(pending, receipt)
      await this.observe()
    } catch (e) {
      if (!this.live) return
      if (
        e instanceof ApiFailure &&
        ["invalid_request", "request_conflict", "admission_closed", "launch_rejected"].includes(e.detail.code)
      ) {
        this.pending.delete(pending.body.request_id)
        this.problem = errorText(e)
        if (e.detail.code === "admission_closed") this.available = false
      } else {
        pending.problem = `${errorText(e)} Recover this submission before starting new work.`
        if (e instanceof ApiFailure && e.detail.code === "wrong_run") {
          this.runLost = true
          this.live = false
          this.available = false
        }
      }
    } finally {
      pending.sending = false
      if (!this.ended) this.changed()
    }
  }
  async recover(id: string) {
    const pending = this.pending.get(id)
    if (!pending || pending.sending || !this.live) return
    pending.sending = true
    this.changed()
    try {
      const result = await this.api.submission(id)
      if (!this.live) return
      if (result.status === "accepted") {
        this.receipt(pending, result.receipt)
        await this.observe()
      } else if (result.status === "rejected") {
        this.pending.delete(id)
        this.problem = result.error.message
      } else pending.problem = "Original admission is still pending."
    } catch (e) {
      if (!this.live) return
      if (
        e instanceof ApiFailure &&
        e.detail.code === "unknown_request" &&
        !pending.receipt &&
        this.available &&
        this.pending.get(id) === pending
      )
        await this.send(pending)
      else pending.problem = errorText(e)
    } finally {
      pending.sending = false
      if (!this.ended) this.changed()
    }
  }
  async observe() {
    if (!this.live) return
    if (this.reading) {
      this.observeAgain = true
      return
    }
    this.reading = true
    clearTimeout(this.timer)
    try {
      const result = await this.api.civitaiOperations()
      if (!this.live) return
      if (result.run_id !== this.api.context.runId) {
        this.runLost = true
        this.live = false
        this.available = false
        throw new Error("Provider observation belongs to another run")
      }
      this.operations = result.operations
      this.problem = undefined
      for (const [id, pending] of this.pending)
        if (
          result.operations.some(
            (o) =>
              o.last_request_id === id &&
              o.outcome.entity_id === pending.body.entity_id &&
              o.outcome.file_id === pending.body.file_id,
          )
        )
          this.pending.delete(id)
      for (const operation of result.operations) {
        const signature = `${operation.outcome.effect_revision}:${operation.outcome.state}`
        if (this.effects.get(operation.operation_id) === signature) continue
        this.effects.set(operation.operation_id, signature)
        this.effectsChanged([
          operation.outcome.entity_id,
          ...operation.outcome.examples.flatMap((e) =>
            e.target_confirmed && e.target_candidate ? [e.target_candidate] : [],
          ),
        ])
        this.projectionRevision++
      }
    } catch (e) {
      if (!this.ended) this.problem = `${errorText(e)} Showing last known provider observations.`
    } finally {
      this.reading = false
      if (!this.ended) this.changed()
      if (this.live && this.operations.some((o) => o.active_request_id))
        this.timer = setTimeout(() => void this.observe(), 700)
      if (this.observeAgain && this.live) {
        this.observeAgain = false
        void this.observe()
      }
    }
  }
  dispose() {
    this.ended = true
    this.live = false
    clearTimeout(this.timer)
  }
}
