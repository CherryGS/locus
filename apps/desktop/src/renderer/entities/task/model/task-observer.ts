import { ApiFailure, errorText, type BackendApi, type Wire } from "@/shared/api"
import { validTask, validOutcome } from "./task-validation"

type TaskApi = Pick<BackendApi, "context" | "tasks" | "taskOutcome" | "taskEvents">
export type TaskObservation = { task: Wire<"PublicTask">; outcome?: Wire<"TaskOutcome">; problem?: string }

/** Run-local observations never submit work. Terminal execution and outcome reads
 * deliberately have independent lifetimes so failed reads cannot revive a task. */
export class TaskObserver {
  readonly records = new Map<string, TaskObservation>()
  problem?: string
  established = false
  private revision = -1n
  private version = 0
  private live = true
  private stream?: AbortController
  private timer?: ReturnType<typeof setTimeout>
  private reading = new Set<string>()
  private listeners = new Set<() => void>()
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  readonly snapshot = () => this.version
  constructor(
    private readonly api: TaskApi,
    private readonly changedImports: () => void,
  ) {}
  private changed() {
    this.version++
    for (const listener of this.listeners) listener()
  }
  accept(value: Wire<"TaskSnapshot">) {
    if (!this.live) return
    if (value.run_id !== this.api.context.runId) {
      this.dispose()
      throw new Error("Task snapshot belongs to another backend run")
    }
    if (!/^\d+$/.test(value.revision) || !Array.isArray(value.tasks))
      throw new Error("Task snapshot attribution is unavailable")
    const revision = BigInt(value.revision)
    if (revision < this.revision) return
    const ids = new Set<string>(),
      requests = new Set<string>()
    for (const task of value.tasks) {
      if (!validTask(task)) throw new Error("Task snapshot is malformed")
      const requestKey = `${task.access_context}:${task.request_id}`
      if (ids.has(task.task_id) || requests.has(requestKey))
        throw new Error("Task snapshot contains duplicate identities")
      ids.add(task.task_id)
      requests.add(requestKey)
      const previous = this.records.get(task.task_id)?.task
      if (
        previous &&
        (previous.access_context !== task.access_context ||
          previous.request_id !== task.request_id ||
          !sameOperation(previous.operation, task.operation))
      )
        throw new Error("Task identity changed in this run")
      if (previous?.state === "terminal" && task.state !== "terminal")
        throw new Error("Task terminal state regressed")
    }
    if ([...this.records.keys()].some((id) => !ids.has(id)))
      throw new Error("Task snapshot omitted retained tasks")
    if (revision === this.revision) {
      this.problem = undefined
      this.changed()
      return
    }
    this.revision = revision
    this.established = true
    this.problem = undefined
    let importsChanged = false
    for (const task of value.tasks) {
      const previous = this.records.get(task.task_id)
      if (
        (task.operation.kind === "import_batch" ||
          task.operation.kind === "import_recovery" ||
          task.operation.kind === "civitai") &&
        (!previous || previous.task.state !== task.state)
      )
        importsChanged = true
      this.records.set(task.task_id, { ...previous, task })
      if (task.state === "terminal" && !previous?.outcome && !previous?.problem)
        void this.outcome(task.task_id)
    }
    this.changed()
    if (importsChanged) this.changedImports()
  }
  async outcome(id: string) {
    if (!this.live || this.reading.has(id)) return
    const record = this.records.get(id)
    if (!record || record.outcome) return
    this.reading.add(id)
    try {
      const value = await this.api.taskOutcome(id)
      if (!this.live) return
      if (value.status !== "complete") throw new Error("Terminal outcome is not available yet")
      if (!validOutcome(value.outcome)) throw new Error("Terminal outcome observation is malformed")
      const operation = record.task.operation,
        outcome = value.outcome
      const matches =
        outcome.status === "failed" ||
        (operation.kind === "civitai"
          ? outcome.status === "civitai" &&
            outcome.operation_id === operation.operation_id &&
            (!outcome.result || outcome.result.entity_id === operation.entity_id)
          : operation.kind === "upload" || operation.kind === "upload_recovery"
            ? outcome.status === "upload" && outcome.result.upload_id === operation.upload_id
            : operation.kind === "import_batch"
              ? outcome.status === "import_batch" && outcome.batch_id === operation.batch_id
              : operation.kind === "import_recovery"
                ? outcome.status === "import_recovery" &&
                  outcome.batch_id === operation.batch_id &&
                  outcome.item_id === operation.item_id
                : operation.kind === "file_import"
                  ? ["imported", "failed"].includes(outcome.status)
                  : operation.kind === "interpretation"
                    ? outcome.status === "media_failed" ||
                      (outcome.status === "interpreted" &&
                        (outcome.result.status !== "accepted" ||
                          sameTarget(outcome.result.record.target, operation.target)))
                    : outcome.status === "media_failed" ||
                      (outcome.status === "preview" &&
                        outcome.preview.kind === operation.target.kind &&
                        outcome.preview.edge === operation.edge))
      if (!matches) throw new Error("Task outcome attribution did not match")
      const current = this.records.get(id)!
      current.outcome = outcome
      current.problem = undefined
    } catch (error) {
      if (error instanceof ApiFailure && error.detail.code === "wrong_run") this.dispose()
      if (this.live) this.records.get(id)!.problem = errorText(error)
    } finally {
      this.reading.delete(id)
      this.changed()
    }
  }
  async reread() {
    if (!this.live) return
    try {
      this.accept(await this.api.tasks())
      for (const [id, record] of this.records) if (record.task.state === "terminal") void this.outcome(id)
    } catch (error) {
      if (error instanceof ApiFailure && error.detail.code === "wrong_run") this.dispose()
      this.problem = errorText(error)
      this.changed()
    }
  }
  start() {
    if (this.live && !this.stream) void this.connect()
  }
  private async connect() {
    const controller = new AbortController()
    this.stream = controller
    try {
      await this.api.taskEvents(controller.signal, (value) => this.accept(value))
    } catch (error) {
      if (this.live) {
        this.problem = `Task observation unavailable: ${errorText(error)}. Earlier records remain last known.`
        if (error instanceof ApiFailure && error.detail.code === "wrong_run") this.dispose()
        this.changed()
      }
    } finally {
      this.stream = undefined
      if (this.live) this.timer = setTimeout(() => this.start(), 1200)
    }
  }
  dispose() {
    this.live = false
    this.stream?.abort()
    clearTimeout(this.timer)
    this.problem = "Backend observation stopped. Records are last known for this run."
    this.changed()
  }
}
function sameTarget(a: Wire<"MediaTarget">, b: Wire<"MediaTarget">) {
  return a.kind === b.kind && a.component_id === b.component_id
}
function sameOperation(a: Wire<"TaskOperation">, b: Wire<"TaskOperation">) {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case "civitai":
      return b.kind === a.kind && a.entity_id === b.entity_id && a.operation_id === b.operation_id
    case "upload":
      return (
        b.kind === a.kind &&
        a.upload_id === b.upload_id &&
        a.byte_count === b.byte_count &&
        a.filename === b.filename
      )
    case "upload_recovery":
      return b.kind === a.kind && a.upload_id === b.upload_id
    case "import_batch":
      return b.kind === a.kind && a.batch_id === b.batch_id && a.item_count === b.item_count
    case "import_recovery":
      return b.kind === a.kind && a.batch_id === b.batch_id && a.item_id === b.item_id
    case "file_import":
      return b.kind === a.kind && a.source_path === b.source_path
    case "interpretation":
      return b.kind === a.kind && sameTarget(a.target, b.target)
    case "preview":
      return b.kind === a.kind && sameTarget(a.target, b.target) && a.edge === b.edge
  }
}
