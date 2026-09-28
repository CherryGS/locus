import { ApiFailure, errorText, type BackendApi, type Wire } from "@/shared/api"
export type TagAttempt = {
  request: string
  run: string
  change: Wire<"TagChange">
  label: string
  state: "pending" | "confirmed" | "failed" | "unconfirmed"
  message: string
  uncertain?: boolean
  recovering?: boolean
}
type TagApi = Pick<BackendApi, "tags" | "tagWrite" | "submission">
/** One run owns frozen attempts independently of any editor's mount lifetime. */
export class TagCoordinator {
  vocabulary?: Wire<"TagRecord">[]
  loading = false
  readError?: string
  opened = false
  hostClosing = false
  attempts: TagAttempt[] = []
  private disposed = false
  private generation = 0
  private revision = 0
  private listeners = new Set<() => void>()
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  readonly snapshot = () => this.revision
  constructor(
    private readonly api: TagApi,
    readonly run: string,
    private readonly invalidate: (ids?: string[]) => void,
  ) {}
  private changed() {
    if (!this.disposed) {
      this.revision++
      this.listeners.forEach((l) => l())
    }
  }
  get unresolved() {
    return this.attempts.filter((a) => a.state === "pending" || a.state === "unconfirmed")
  }
  get pending() {
    return this.attempts.some((a) => a.state === "pending")
  }
  show() {
    this.opened = true
    this.changed()
    void this.read()
  }
  close() {
    this.opened = false
    this.changed()
  }
  host(closing: boolean) {
    this.hostClosing = closing
    if (closing) this.opened = false
    this.changed()
  }
  dispose() {
    this.disposed = true
    this.generation++
    this.listeners.clear()
    this.attempts = []
    this.vocabulary = undefined
  }
  async read() {
    if (this.disposed) return
    const ticket = ++this.generation
    this.loading = true
    this.readError = undefined
    this.changed()
    try {
      const tags = await this.api.tags()
      if (!this.disposed && ticket === this.generation) this.vocabulary = tags
    } catch (e) {
      if (!this.disposed && ticket === this.generation) this.readError = errorText(e)
    } finally {
      if (!this.disposed && ticket === this.generation) {
        this.loading = false
        this.changed()
      }
    }
  }
  async write(change: Wire<"TagChange">, label: string) {
    if (this.disposed || this.hostClosing) return
    const attempt: TagAttempt = {
      request: crypto.randomUUID(),
      run: this.run,
      change: structuredClone(change),
      label,
      state: "pending",
      message: "Saving…",
    }
    this.attempts.push(attempt)
    this.changed()
    try {
      this.complete(
        attempt,
        await this.api.tagWrite({ request_id: attempt.request, change: attempt.change }),
      )
    } catch (e) {
      if (this.disposed) return
      const definite =
        e instanceof ApiFailure &&
        ["invalid_request", "admission_closed", "launch_rejected"].includes(e.detail.code)
      attempt.state = definite ? "failed" : "unconfirmed"
      attempt.message = `${definite ? "Not accepted" : "Delivery unconfirmed; use Recover original request"}: ${errorText(e)}`
      this.changed()
    }
    return attempt
  }
  private complete(attempt: TagAttempt, outcome: Wire<"MutationOutcome">) {
    if (this.disposed) return
    const change = attempt.change
    const matches =
      outcome.status === "tag_saved"
        ? change.operation === "create" ||
          (change.operation === "rename" && outcome.tag.id === change.id)
        : outcome.status === "tag_deleted"
          ? change.operation === "delete" && outcome.id === change.id
          : outcome.status === "tag_assignment"
            ? (change.operation === "add" || change.operation === "remove") &&
              outcome.entity_id === change.entity_id &&
              outcome.tag_id === change.tag_id
            : outcome.status === "tag_failed"
    if (!matches) {
      attempt.state = "unconfirmed"
      attempt.message =
        "Response did not match the captured Tag operation. Recover the original request."
      this.changed()
      return
    }
    if (outcome.status === "tag_failed") {
      attempt.state = outcome.uncertain ? "unconfirmed" : "failed"
      attempt.uncertain = outcome.uncertain
      attempt.message = `${outcome.uncertain ? "Commit unconfirmed" : "Not saved"}: ${outcome.message}`
      if (outcome.reason === "conflict" || outcome.reason === "missing_tag" || outcome.uncertain) {
        this.invalidate()
        void this.read()
      }
    } else if (["tag_saved", "tag_deleted", "tag_assignment"].includes(outcome.status)) {
      attempt.state = "confirmed"
      attempt.message =
        outcome.status === "tag_assignment" && !outcome.changed
          ? "Confirmed · already in this state"
          : "Confirmed · saved"
      this.invalidate("entity_id" in attempt.change ? [attempt.change.entity_id] : undefined)
      void this.read()
    } else {
      attempt.state = "unconfirmed"
      attempt.message = "Completion did not supply a Tag outcome. Recover the original request."
    }
    this.changed()
  }
  async recover(attempt: TagAttempt) {
    if (this.disposed || attempt.run !== this.run || attempt.recovering) return
    attempt.recovering = true
    this.changed()
    try {
      const value = await this.api.submission(attempt.request)
      if (this.disposed) return
      if (value.status === "direct_complete") this.complete(attempt, value.outcome)
      else if (value.status === "rejected") {
        attempt.state = "failed"
        attempt.message = `Not accepted: ${value.error.message}`
      } else {
        attempt.state = "unconfirmed"
        attempt.message = "Original request is still pending. Recover again to observe completion."
      }
    } catch (e) {
      if (
        !this.disposed &&
        e instanceof ApiFailure &&
        e.detail.code === "unknown_request" &&
        !attempt.uncertain
      ) {
        // Explicit recovery redelivers only the same frozen request within this run.
        try {
          this.complete(
            attempt,
            await this.api.tagWrite({ request_id: attempt.request, change: attempt.change }),
          )
        } catch (delivery) {
          if (!this.disposed) {
            attempt.state = "unconfirmed"
            attempt.message = `Original request redelivery unconfirmed: ${errorText(delivery)}`
          }
        }
      } else if (!this.disposed) {
        attempt.state = "unconfirmed"
        attempt.message = `Recovery failed; no rollback is established: ${errorText(e)}`
      }
    } finally {
      attempt.recovering = false
      this.changed()
    }
  }
}
