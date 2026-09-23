import { ApiFailure, errorText, type BackendApi, type Wire } from "@/shared/api"
import type { DesktopBridge, DesktopState } from "../../../../shared/desktop-bridge"

type ImportApi = Pick<BackendApi, "context" | "importBatch" | "recoverImport" | "imports" | "submission">
type Pending = {
  body: Wire<"BatchImportRequest"> | Wire<"ImportRecoveryRequest">
  pending: boolean
  accepted?: boolean
  receipt?: Wire<"Receipt">
  problem?: string
}
export class ImportCoordinator {
  batches: Wire<"ImportBatch">[] = []
  readonly submissions = new Map<string, Pending>()
  readonly notices: string[] = []
  private readonly accepted = new Map<string, Pending>()
  selecting = false
  problem?: string
  feedback?: string
  available = true
  observing = false
  private admissionOpen = true
  private hostOpen = true
  private observeAgain = false
  private live = true
  private runLost = false
  private version = 0
  private effects = new Map<string, string>()
  private listeners = new Set<() => void>()
  private timer?: ReturnType<typeof setTimeout>
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  readonly snapshot = () => this.version
  constructor(
    private readonly api: ImportApi,
    private readonly bridge: Pick<DesktopBridge, "selectImportFiles">,
    private readonly changedEffects: (items: Wire<"ImportItem">[]) => void,
    private readonly uuid = () => crypto.randomUUID(),
  ) {}
  private changed() {
    this.version++
    for (const listener of this.listeners) listener()
  }
  host(state: DesktopState) {
    this.live =
      !this.runLost &&
      state.connection.status === "ready" &&
      state.connection.runId === this.api.context.runId
    this.hostOpen = state.close.phase === "idle"
    this.available = this.live && this.hostOpen && this.admissionOpen
    if (!this.live) {
      clearTimeout(this.timer)
      this.problem =
        "The backend run is unavailable. Retained results are last known; restart does not replay imports."
    }
    this.changed()
  }
  async select() {
    if (!this.available || this.selecting) return
    this.selecting = true
    this.changed()
    try {
      const selection = await this.bridge.selectImportFiles()
      if (selection.status === "failed") throw new Error(selection.message)
      if (selection.status !== "selected" || !selection.paths.length || !this.available) return
      await this.send({ request_id: this.uuid(), source_paths: selection.paths })
    } catch (error) {
      this.problem = errorText(error)
      this.notices.push(`File selection failed: ${this.problem}`)
    } finally {
      this.selecting = false
      this.changed()
    }
  }
  async recover(batch: string, item: string, action: Wire<"ImportAction">) {
    if (!this.available || this.itemPending(item)) return
    await this.send({ request_id: this.uuid(), batch_id: batch, item_id: item, action })
  }
  itemPending(id: string) {
    return [...this.submissions.values()].some((s) => "item_id" in s.body && s.body.item_id === id)
  }
  observeTasks(tasks: Wire<"PublicTask">[]) {
    for (const [id, saved] of new Map([...this.accepted, ...this.submissions])) {
      const task = tasks.find((value) => value.access_context === "desktop" && value.request_id === id)
      if (!task) continue
      const operation = task.operation
      const matches =
        "source_paths" in saved.body
          ? operation.kind === "import_batch" &&
            operation.item_count === saved.body.source_paths.length
          : operation.kind === "import_recovery" &&
            operation.batch_id === saved.body.batch_id &&
            operation.item_id === saved.body.item_id
      if (!matches || (saved.receipt && saved.receipt.task_id !== task.task_id)) {
        this.loseRun()
        this.problem = "Observed import task attribution did not match. This submission will not be replayed."
        this.changed()
        return
      }
      saved.accepted = true
      saved.receipt = { run_id: this.api.context.runId, request_id: id, task_id: task.task_id }
      this.accepted.set(id, saved)
    }
    this.changed()
  }
  private loseRun() {
    this.runLost = true
    this.live = false
    this.available = false
    clearTimeout(this.timer)
  }
  private async send(body: Pending["body"], submission: Pending = { body, pending: true }) {
    submission.pending = true
    this.submissions.set(body.request_id, submission)
    this.changed()
    try {
      const receipt =
        "source_paths" in body ? await this.api.importBatch(body) : await this.api.recoverImport(body)
      if (
        receipt.run_id !== this.api.context.runId ||
        receipt.request_id !== body.request_id ||
        (submission.receipt && submission.receipt.task_id !== receipt.task_id)
      ) {
        this.loseRun()
        throw new Error("Import receipt attribution did not match. This submission will not be replayed.")
      }
      submission.accepted = true
      submission.receipt = receipt
      this.accepted.set(body.request_id, submission)
      submission.pending = false
      await this.observe()
    } catch (error) {
      // Definite rejection permits a new explicit action; transport/observer loss
      // keeps the original identity until same-run recovery establishes it.
      if (
        error instanceof ApiFailure &&
        ["invalid_request", "request_conflict", "admission_closed", "launch_rejected"].includes(
          error.detail.code,
        )
      ) {
        this.submissions.delete(body.request_id)
        this.problem = errorText(error)
        this.notices.push(`Submission ${body.request_id} was rejected: ${this.problem}`)
        if (error.detail.code === "admission_closed") {
          this.admissionOpen = false
          this.available = false
        }
      } else {
        if (error instanceof ApiFailure && error.detail.code === "wrong_run") this.loseRun()
        submission.problem = errorText(error)
        submission.pending = false
      }
    }
    this.changed()
  }
  async checkRequest(id: string) {
    const saved = this.submissions.get(id)
    if (!this.live || !saved || saved.pending) return
    saved.pending = true
    this.changed()
    try {
      const outcome = await this.api.submission(id)
      if (outcome.status === "accepted") {
        if (outcome.receipt.run_id !== this.api.context.runId || outcome.receipt.request_id !== id) {
          this.loseRun()
          throw new Error(
            "Recovered receipt attribution did not match. This submission will not be replayed.",
          )
        }
        saved.accepted = true
        if (saved.receipt && saved.receipt.task_id !== outcome.receipt.task_id) {
          this.loseRun()
          throw new Error("Recovered task identity changed. This submission will not be replayed.")
        }
        saved.receipt = outcome.receipt
        this.accepted.set(id, saved)
        saved.pending = false
        await this.observe()
      } else if (outcome.status === "rejected") {
        this.submissions.delete(id)
        this.problem = outcome.error.message
        this.notices.push(`Submission ${id} was rejected: ${this.problem}`)
      } else
        saved.problem =
          "The original request has no attributable import receipt. No new import was submitted."
    } catch (error) {
      if (error instanceof ApiFailure && error.detail.code === "wrong_run") this.loseRun()
      if (error instanceof ApiFailure && error.detail.code === "unknown_request") {
        // An explicit check may restore a lost delivery in this same run. Reuse
        // the exact original request and record, never a new recovery branch.
        if (!saved.accepted && this.live && this.available && this.submissions.get(id) === saved) {
          await this.send(saved.body, saved)
        } else {
          saved.problem = saved.accepted
            ? "The previously accepted request is unavailable. Its original outcome remains unconfirmed; it will not be replayed."
            : "The original request is unknown, but this run is unavailable or new work is closed. No import was replayed."
        }
      } else saved.problem = errorText(error)
    } finally {
      saved.pending = false
      this.changed()
    }
  }
  async observe() {
    if (!this.live) return
    if (this.observing) {
      this.observeAgain = true
      return
    }
    clearTimeout(this.timer)
    this.observing = true
    this.changed()
    try {
      const snapshot = await this.api.imports()
      if (!this.live) return
      if (snapshot.run_id !== this.api.context.runId) {
        this.loseRun()
        throw new Error("Import snapshot belongs to another backend run.")
      }
      this.admissionOpen = snapshot.admission === "open"
      this.available = this.live && this.hostOpen && this.admissionOpen
      const effects: Wire<"ImportItem">[] = []
      for (const batch of snapshot.batches)
        for (const item of batch.items) {
          if (
            item.current.base.state === "success" &&
            this.effects.get(item.item_id) !== item.current.effect_revision
          ) {
            effects.push(item)
            this.effects.set(item.item_id, item.current.effect_revision)
          }
        }
      for (const [id, saved] of this.submissions) {
        if (
          snapshot.batches.some((b) =>
            "source_paths" in saved.body
              ? b.access_context === "desktop" && b.original_request_id === id
              : b.batch_id === saved.body.batch_id &&
                b.items.some(
                  (i) =>
                    "item_id" in saved.body &&
                    i.item_id === saved.body.item_id &&
                    i.attempts?.some((a) => a.request_id === id),
                ),
          )
        )
          this.submissions.delete(id)
      }
      this.batches = snapshot.batches
      this.problem = undefined
      if (effects.length) this.changedEffects(effects)
      const active = this.batches.some((b) => !b.original_ended || b.items.some((i) => !!i.active_request_id))
      // Recovery may finish between two observations; terminal feedback is a
      // projection of current results, not a transition that requires seeing active.
      if (!active && this.batches.length > 0) {
        const items = this.batches.flatMap((b) => b.items)
        const attention = items.filter((i) => !i.active_request_id && !i.current.complete).length
        this.feedback = attention ? `Imports: ${attention} need attention` : "Imports complete"
      }
      if (active) this.timer = setTimeout(() => void this.observe(), 400)
    } catch (error) {
      if (error instanceof ApiFailure && error.detail.code === "wrong_run") this.loseRun()
      this.problem = `Import observation unavailable: ${errorText(error)}. Earlier results remain last known.`
    } finally {
      this.observing = false
      this.changed()
      if (this.observeAgain) {
        this.observeAgain = false
        void this.observe()
      }
    }
  }
  dispose() {
    this.live = false
    clearTimeout(this.timer)
  }
}
