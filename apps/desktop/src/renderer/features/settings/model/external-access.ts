import { createExternalAddressDefaults, ExternalAddressGroupId, type ExternalAddress } from "@locus/client"
import { ApiFailure, diagnosticText, errorText, type BackendApi, type Wire } from "@/shared/api"
import { SettingsCoordinator } from "./settings-coordinator"

export function externalAddressSettings(api: BackendApi) {
  return new SettingsCoordinator<ExternalAddress, Wire<"ExternalRuntime">>(api, () => crypto.randomUUID(), {
    groupId: ExternalAddressGroupId,
    defaults: createExternalAddressDefaults(),
    runtime: () => api.externalRuntime(),
    typed(value) {
      if (!value || typeof value !== "object" || !("address" in value) || typeof value.address !== "string")
        throw new Error("External address has an invalid saved shape.")
      return { address: value.address }
    },
  })
}

type Api = Pick<BackendApi, "externalToken" | "resetExternalToken" | "submission" | "context">
/** Original reset results establish execution; a fresh read establishes the current credential. */
export class ExternalTokenCoordinator {
  observation?: Wire<"TokenObservation">
  problem?: string
  feedback?: string
  pending = false
  attempt?: Wire<"ResetToken">
  private live = true
  private ticket = 0
  private version = 0
  private readonly runId: string
  private listeners = new Set<() => void>()

  constructor(
    private api: Api,
    private uuid = () => crypto.randomUUID()
  ) {
    this.runId = api.context.runId
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
  get current() {
    return this.live &&
      !this.pending &&
      !this.attempt &&
      !this.problem &&
      this.observation?.status === "current"
      ? this.observation
      : undefined
  }
  private sameRun() {
    if (!this.live) return false
    if (this.api.context.runId !== this.runId) this.lost("The backend run changed. Restart the application.")
    return this.live
  }
  async read() {
    if (!this.sameRun() || this.attempt || this.pending) return
    const ticket = ++this.ticket
    this.pending = true
    this.changed()
    try {
      const value = await this.api.externalToken()
      if (!this.sameRun() || ticket !== this.ticket) return
      if (value.run_id !== this.runId) {
        this.lost("The backend run changed. Restart the application.")
        return
      }
      this.observation = value
      this.problem = value.status === "unavailable" ? value.message : undefined
    } catch (error) {
      if (!this.sameRun() || ticket !== this.ticket) return
      if (error instanceof ApiFailure && error.detail.code === "wrong_run")
        this.lost("The backend run changed. Restart the application.")
      else this.problem = errorText(error)
    } finally {
      if (ticket === this.ticket) {
        this.pending = false
        this.changed()
      }
    }
  }
  async reset() {
    if (!this.sameRun() || !this.current) return
    const attempt = { request_id: this.uuid(), expected_revision: this.current.revision }
    this.attempt = attempt
    await this.execute(attempt, false)
  }
  async recover() {
    if (!this.sameRun() || this.pending) return
    if (!this.attempt) return this.read()
    await this.execute(this.attempt, true)
  }
  private async execute(attempt: Wire<"ResetToken">, recover: boolean) {
    const ticket = ++this.ticket
    const applies = () => this.sameRun() && ticket === this.ticket && this.attempt === attempt
    this.pending = true
    this.problem = undefined
    this.feedback = undefined
    this.changed()
    let reread = false
    let delivering = !recover
    try {
      let result: Wire<"MutationOutcome">
      if (recover) {
        let original: Wire<"Submission">
        try {
          original = await this.api.submission(attempt.request_id)
        } catch (error) {
          if (!applies()) return
          if (!(error instanceof ApiFailure) || error.detail.code !== "unknown_request") throw error
          // Redelivery belongs to this live run and the exact original reset.
          delivering = true
          original = { status: "direct_complete", outcome: await this.api.resetExternalToken(attempt) }
        }
        if (!applies()) return
        if (original.status === "rejected") {
          this.attempt = undefined
          this.feedback = `Reset was rejected: ${original.error.message}`
          reread = true
          return
        }
        if (original.status !== "direct_complete") {
          this.problem =
            original.status === "direct_pending"
              ? "Original reset is still running. Recover its result again."
              : "The original request has no confirmed Token reset result. No new reset was submitted."
          return
        }
        result = original.outcome
      } else result = await this.api.resetExternalToken(attempt)
      if (!applies()) return
      if (
        result.status === "token_reset" ||
        result.status === "token_reset_failed" ||
        result.status === "failed"
      ) {
        this.attempt = undefined
        reread = true
        this.feedback =
          result.status === "token_reset"
            ? "Token reset completed."
            : result.status === "token_reset_failed"
              ? `Previous reset: ${result.message}`
              : `Reset execution ended without confirmation: ${diagnosticText(result.diagnostic)}`
        // An older result cannot install a secret, and ended execution does not
        // establish rollback. Read the owner after execution has actually ended.
      } else this.problem = "Reset response was not attributable. Recover the original request."
    } catch (error) {
      if (!applies()) return
      if (error instanceof ApiFailure && error.detail.code === "wrong_run")
        this.lost("The backend run changed. Restart the application.")
      else if (delivering && error instanceof ApiFailure && error.detail.code !== "operation_failed") {
        this.attempt = undefined
        this.feedback = `Reset was rejected: ${errorText(error)}`
        reread = true
      } else this.problem = `Token reset is unconfirmed: ${errorText(error)}`
    } finally {
      if (ticket === this.ticket) {
        this.pending = false
        this.changed()
        if (reread) await this.read()
      }
    }
  }
  lost(message: string) {
    this.live = false
    this.ticket++
    this.pending = false
    this.observation = undefined
    this.problem = message
    this.changed()
  }
}
