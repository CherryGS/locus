import type { BackendApi, Wire } from "@/shared/api"

type Attempt = Wire<"WriteEntityNotes">
type Outcome = Awaited<ReturnType<BackendApi["writeEntityNotes"]>>
type Observation = { notes: string; revision: number }

/** This attempt has not been sent: another page still owns uncertain work. */
export class NotesWriteBlocked extends Error {}

/** Run-owned submission lane; drafts belong to individual page coordinators. */
export class EntityNotesWrites {
  private tails = new Map<string, Promise<void>>()
  private uncertain = new Map<string, Attempt>()
  private confirmed = new Map<string, Observation>()
  private listeners = new Set<(id: string, notes: string) => void>()
  private consumers = new Map<string, number>()
  private revision = 0
  constructor(private api: Pick<BackendApi, "writeEntityNotes">) {}
  subscribe(listener: (id: string, notes: string) => void) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  observation(id: string) { return this.confirmed.get(id) }
  retain(id: string) {
    this.consumers.set(id, (this.consumers.get(id) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const count = (this.consumers.get(id) ?? 1) - 1
      if (count) this.consumers.set(id, count)
      else this.consumers.delete(id)
      this.prune(id)
    }
  }
  private prune(id: string) {
    if (!this.consumers.has(id) && !this.tails.has(id) && !this.uncertain.has(id))
      this.confirmed.delete(id)
  }
  observe(id: string, notes: string) {
    if (this.confirmed.get(id)?.notes === notes) return
    this.confirmed.set(id, { notes, revision: ++this.revision })
    for (const listener of this.listeners) listener(id, notes)
  }
  submit(id: string, attempt: Attempt): Promise<Outcome> {
    const previous = this.tails.get(id) ?? Promise.resolve()
    const work = previous.then(async () => {
      const original = this.uncertain.get(id)
      if (original && original.request_id !== attempt.request_id)
        throw new NotesWriteBlocked("Another page has an unconfirmed save for these notes. Resolve that save before retrying here.")
      if (original && original.notes !== attempt.notes)
        throw new NotesWriteBlocked("The original notes request must keep its captured text.")
      this.uncertain.set(id, attempt)
      const result = await this.api.writeEntityNotes(id, attempt)
      if (result.status === "failed") this.uncertain.delete(id)
      else if (result.status === "entity_notes_saved" && result.notes.entity_id === id && result.notes.notes === attempt.notes) {
        this.uncertain.delete(id)
        this.observe(id, result.notes.notes)
      } else throw new Error("The notes save could not be confirmed.")
      return result
    })
    // Retain the original request after uncertain delivery without poisoning
    // the Promise lane: its owner can retry and then release other writers.
    const tail = work.then(() => {}, () => {})
    this.tails.set(id, tail)
    void tail.then(() => {
      if (this.tails.get(id) === tail) this.tails.delete(id)
      this.prune(id)
    })
    return work
  }
}
