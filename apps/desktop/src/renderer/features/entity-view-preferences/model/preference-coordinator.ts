import { ApiFailure, commitUnknown, diagnosticText, errorText, type BackendApi, type Wire } from "@/shared/api"
import type { ReadProblem } from "@/entities/entity"
import type { UnconfirmedChoice } from "../../../../shared/desktop-bridge"

type PreferenceApi = Pick<BackendApi, "preferences" | "savePreference" | "submission">
type Attempt = { readonly body: Wire<"UpdateViewPreference">; readonly intent: number }
export type PreferenceState = {
  entityId: string
  observation?: Wire<"EntityViewPreference">
  readPending: boolean
  readAttempted: boolean
  readProblem?: string
  intended?: string
  intent: number
  confirmedIntent?: number
  status: "idle" | "saving" | "saved" | "unsaved" | "unconfirmed"
  problem?: string
  attempt?: Attempt
  needsRead?: boolean
  basisVersion: number
}
type Entry = PreferenceState & {
  readGeneration: number
  work?: Promise<void>
  readWork?: Promise<void>
  waitingForRead?: boolean
}

export class PreferenceCoordinator {
  private entries = new Map<string, Entry>()
  private listeners = new Set<() => void>()
  private needed = new Set<string>()
  private version = 0
  private live = true
  private sealed = false
  private readBusy = false
  private nextRead?: { ids: string[]; done: () => void }
  intentRevision = 0
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  readonly snapshot = () => this.version
  constructor(
    private readonly api: PreferenceApi,
    private readonly uuid = () => crypto.randomUUID(),
    readonly capacity = 256
  ) {}
  private changed() {
    this.version++
    for (const listener of this.listeners) listener()
    this.prune()
  }
  get cacheSize() {
    return this.entries.size
  }
  get isSealed() {
    return this.sealed
  }
  get(id: string): PreferenceState {
    return (
      this.entries.get(id) ?? {
        entityId: id,
        readPending: false,
        readAttempted: false,
        intent: 0,
        status: "idle",
        basisVersion: 0,
      }
    )
  }
  private entry(id: string) {
    let entry = this.entries.get(id)
    if (!entry) {
      entry = { ...this.get(id), readGeneration: 0 }
      this.entries.set(id, entry)
    }
    return entry
  }
  demand(ids: string[]) {
    this.needed = new Set(ids)
    for (const id of ids) {
      const entry = this.entries.get(id)
      if (entry) {
        this.entries.delete(id)
        this.entries.set(id, entry)
      }
    }
    const unread = ids.filter((id) => !this.get(id).readAttempted && !this.get(id).readPending)
    if (unread.length) void this.read(unread)
    this.prune()
  }
  read(ids: string[]) {
    const work = this.readBatch(ids)
    for (const id of ids) this.entry(id).readWork = work
    return work
  }
  private async readBatch(ids: string[]): Promise<void> {
    if (!this.live) return
    if (this.readBusy) {
      const preserved = [...this.entries.values()]
        .filter((entry) => entry.waitingForRead)
        .map((entry) => entry.entityId)
      this.nextRead?.done()
      await new Promise<void>((done) => {
        this.nextRead = { ids: [...new Set([...preserved, ...ids])], done }
      })
      return
    }
    this.readBusy = true
    const tickets = ids.map((id) => {
      const entry = this.entry(id)
      entry.readPending = true
      entry.readAttempted = true
      return { entry, generation: ++entry.readGeneration, basis: entry.basisVersion }
    })
    this.changed()
    try {
      const values = await this.api.preferences(ids)
      if (values.length !== ids.length || values.some((value, index) => value.entity_id !== ids[index]))
        throw new Error("Preference observations did not match the requested identities.")
      tickets.forEach(({ entry, generation, basis }, index) => {
        if (!this.live || entry.readGeneration !== generation || this.entries.get(entry.entityId) !== entry) return
        entry.readPending = false
        if (entry.basisVersion !== basis) return
        entry.observation = values[index]
        entry.basisVersion++
        entry.readProblem = undefined
        if (entry.needsRead && !entry.attempt) {
          entry.needsRead = false
          if (entry.observation.status === "saved" && entry.observation.view_definition_id === entry.intended) {
            entry.confirmedIntent = entry.intent
            entry.status = "saved"
            entry.problem = undefined
          } else {
            entry.status = "unsaved"
            entry.problem =
              "The current choice is not saved. Retry saves this choice using the newly observed revision."
          }
        }
        if (entry.waitingForRead && entry.intended && !entry.attempt && !entry.needsRead) {
          entry.waitingForRead = false
          entry.status = "saving"
          this.start(entry)
        }
      })
    } catch (error) {
      for (const { entry, generation, basis } of tickets)
        if (this.live && this.entries.get(entry.entityId) === entry && entry.readGeneration === generation) {
          entry.readPending = false
          // The ticket finished even when a mutation supplied a newer basis.
          // Its stale failure cannot replace that newer observation or problem.
          if (entry.basisVersion !== basis) continue
          entry.readProblem = errorText(error)
          entry.waitingForRead = false
          if (entry.intended && !entry.attempt) {
            entry.status = "unsaved"
            entry.problem = "Cannot save without a successful preference observation. Retry the preference read."
          }
        }
    } finally {
      this.readBusy = false
      const next = this.nextRead
      this.nextRead = undefined
      if (next)
        void this.read(next.ids.filter((id) => this.needed.has(id) || this.entries.get(id)?.intended)).finally(
          next.done
        )
    }
    this.changed()
  }
  choose(id: string, viewId: string) {
    if (!this.live || this.sealed) return false
    const entry = this.entry(id)
    entry.intended = viewId
    entry.intent++
    this.intentRevision++
    // Retain an existing failure while the new evidence is pending.
    if (!entry.attempt && !entry.needsRead) entry.status = "saving"
    this.changed()
    if (!entry.observation || entry.readProblem) {
      entry.waitingForRead = true
      if (!entry.readPending) void this.read([id])
    } else this.start(entry)
    return true
  }
  retry(id: string) {
    const entry = this.entry(id)
    if (!this.live || this.sealed || entry.work) return
    if (entry.attempt) {
      void this.recover(id)
      return
    }
    if (entry.needsRead || !entry.observation || entry.readProblem) {
      if (!entry.needsRead) entry.waitingForRead = true
      void this.read([id])
      return
    }
    if (!entry.intended) return
    entry.status = "saving"
    this.start(entry)
  }
  private start(entry: Entry) {
    if (!this.live || this.sealed || entry.work || entry.attempt || entry.needsRead || !entry.intended) return
    const observed = entry.observation
    if (!observed || entry.readProblem) {
      entry.waitingForRead = true
      if (!entry.readPending) {
        entry.status = "unsaved"
        entry.problem = "A successful preference read is required before saving."
        this.changed()
      }
      return
    }
    if (observed.status === "missing") {
      entry.status = "unsaved"
      entry.problem = "This Entity is unavailable; its choice cannot be saved."
      this.changed()
      return
    }
    const attempt: Attempt = {
      intent: entry.intent,
      body: Object.freeze({
        request_id: this.uuid(),
        view_definition_id: entry.intended,
        expected_revision: observed.status === "saved" ? observed.revision : null,
      }),
    }
    entry.attempt = attempt
    entry.status = "saving"
    this.run(entry, async () => {
      try {
        this.complete(entry, attempt, await this.api.savePreference(entry.entityId, attempt.body))
      } catch (error) {
        if (!this.live) return
        if (error instanceof ApiFailure && !["operation_failed"].includes(error.detail.code)) {
          if (error.detail.code === "wrong_run") {
            this.lost("The backend run changed. Restart Locus; this choice has not been replayed.")
            return
          }
          entry.attempt = undefined
          entry.status = entry.intent !== attempt.intent ? "saving" : "unsaved"
          entry.problem = errorText(error)
        } else {
          entry.status = "unconfirmed"
          entry.problem = `Saving could not be confirmed: ${errorText(error)}`
          await this.lookup(entry, attempt)
        }
      }
    })
  }
  private run(entry: Entry, operation: () => Promise<void>) {
    entry.work = Promise.resolve()
      .then(operation)
      .finally(() => {
        entry.work = undefined
        this.changed()
        // Only a newer, unsent intent may follow settled earlier work. Failure of
        // the current choice always waits for intentional recovery, never a loop.
        if (this.live && !entry.attempt && !entry.needsRead && entry.intended && entry.status === "saving")
          this.start(entry)
      })
    this.changed()
  }
  private complete(entry: Entry, attempt: Attempt, outcome: Wire<"MutationOutcome">) {
    if (!this.live || entry.attempt !== attempt) return
    entry.attempt = undefined
    switch (outcome.status) {
      case "view_preference_saved":
        if (outcome.preference.entity_id !== entry.entityId) {
          entry.attempt = attempt
          entry.status = "unconfirmed"
          entry.problem = "Save confirmation named another Entity."
          return
        }
        entry.observation = { ...outcome.preference, status: "saved" }
        entry.basisVersion++
        entry.readProblem = undefined
        entry.readGeneration++
        entry.readPending = false
        if (entry.intent === attempt.intent) {
          entry.status = "saved"
          entry.confirmedIntent = entry.intent
          entry.problem = undefined
        } else {
          entry.status = "saving"
          entry.problem = undefined
        }
        break
      case "view_preference_conflict":
        entry.observation = outcome.current
        entry.basisVersion++
        entry.status = entry.intent !== attempt.intent ? "saving" : "unsaved"
        entry.problem = "The saved preference changed. Retry the current choice using the observed revision."
        break
      case "view_preference_missing":
        entry.observation = { entity_id: entry.entityId, status: "missing" }
        entry.basisVersion++
        entry.status = "unsaved"
        entry.problem = "This Entity is unavailable; its choice was not saved."
        break
      case "failed":
        entry.problem = diagnosticText(outcome.diagnostic)
        entry.needsRead = commitUnknown(outcome.diagnostic)
        entry.status = entry.needsRead ? "unconfirmed" : entry.intent !== attempt.intent ? "saving" : "unsaved"
        // A terminal uncertain result cannot later apply more work. Only an
        // actual fresh read may establish its durable value before another write.
        break
      default:
        entry.attempt = attempt
        entry.status = "unconfirmed"
        entry.problem = "The request returned an unexpected operation outcome."
    }
  }
  async recover(id: string) {
    const entry = this.entry(id)
    if (!this.live || this.sealed || entry.work) return
    if (!entry.attempt) {
      if (entry.needsRead) await this.read([id])
      return
    }
    const attempt = entry.attempt
    this.run(entry, () => this.lookup(entry, attempt))
    await entry.work
  }
  private async lookup(entry: Entry, attempt: Attempt) {
    try {
      const result = await this.api.submission(attempt.body.request_id)
      if (!this.live || entry.attempt !== attempt) return
      if (result.status === "direct_complete") this.complete(entry, attempt, result.outcome)
      else if (result.status === "rejected") {
        entry.attempt = undefined
        entry.status = entry.intent !== attempt.intent ? "saving" : "unsaved"
        entry.problem = result.error.message
      } else {
        entry.status = "unconfirmed"
        entry.problem = "The original save is still pending. Check its confirmation before another save."
      }
    } catch (error) {
      if (!this.live) return
      if (error instanceof ApiFailure && error.detail.code === "unknown_request") {
        // Recovery re-delivers exactly the original body. Conditional revisions
        // and the original binding prevent this from overwriting a newer save.
        try {
          this.complete(entry, attempt, await this.api.savePreference(entry.entityId, attempt.body))
        } catch (delivery) {
          entry.status = "unconfirmed"
          entry.problem = `Original submission remains unconfirmed: ${errorText(delivery)}`
        }
      } else if (error instanceof ApiFailure && error.detail.code === "wrong_run")
        this.lost("The backend run changed. Restart Locus to read actual saved preferences.")
      else {
        entry.status = "unconfirmed"
        entry.problem = `Confirmation could not be read: ${errorText(error)}`
      }
    }
  }
  problems(id: string): ReadProblem[] {
    const entry = this.get(id)
    const problems: ReadProblem[] = []
    if (entry.readProblem)
      problems.push({
        key: "preference-read",
        subject: `Entity ${id} preference`,
        message: entry.readProblem,
        previous: !!entry.observation,
        recovery: "preference-read",
      })
    if (!entry.readProblem && entry.observation?.status === "missing")
      problems.push({
        key: "preference-entity",
        subject: `Entity ${id} preference`,
        message: "This Entity was unavailable when its preference was read.",
        recovery: "preference-read",
      })
    if (entry.problem)
      problems.push({
        key: "preference-save",
        subject: `Entity ${id} choice ${entry.intended ?? ""}`,
        message: entry.problem,
        recovery: entry.status === "unconfirmed" || entry.attempt ? "preference-check" : "preference-save",
      })
    return problems
  }
  pendingChoices(): UnconfirmedChoice[] {
    return [...this.entries.values()]
      .filter((entry) => entry.intended && (entry.confirmedIntent !== entry.intent || !!entry.attempt))
      .map((entry) => ({
        entityId: entry.entityId,
        viewId: entry.intended!,
        reason:
          entry.problem ??
          (entry.status === "saving" ? "Saving is still pending." : "The current choice has not been confirmed saved."),
      }))
  }
  async prepare() {
    // Wait on accepted/in-flight work and check uncertain originals once. Known
    // failures are surfaced; closing is not an automatic retry policy.
    const unsettled = [...this.entries.values()].filter(
      (entry) => entry.intended && entry.confirmedIntent !== entry.intent
    )
    for (const entry of unsettled) if (entry.attempt && !entry.work) void this.recover(entry.entityId)
    while (this.live) {
      const working = [...this.entries.values()].flatMap((entry) =>
        [entry.work, entry.waitingForRead ? entry.readWork : undefined].filter((work): work is Promise<void> => !!work)
      )
      if (!working.length) break
      await Promise.allSettled(working)
    }
    return { revision: this.intentRevision, items: this.pendingChoices() }
  }
  seal(revision: number, continueExit: boolean) {
    if (revision !== this.intentRevision || (!continueExit && this.pendingChoices().length > 0)) return false
    this.sealed = true
    this.changed()
    return true
  }
  returnToApplication() {
    this.sealed = false
    this.changed()
  }
  lost(message: string) {
    this.live = false
    for (const entry of this.entries.values())
      if (entry.intended && entry.confirmedIntent !== entry.intent) {
        entry.status = "unconfirmed"
        entry.problem = message
      }
    this.changed()
  }
  private prune() {
    for (const [id, entry] of this.entries) {
      if (this.entries.size <= this.capacity) break
      if (
        !this.needed.has(id) &&
        !entry.work &&
        !entry.attempt &&
        (!entry.intended || entry.confirmedIntent === entry.intent)
      )
        this.entries.delete(id)
    }
  }
}
