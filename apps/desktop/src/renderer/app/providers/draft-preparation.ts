import type { SettingsReadiness } from "../../../shared/desktop-bridge"

export interface DraftPreparationParticipant {
  subscribe(listener: () => void): () => void
  prepare(): Promise<SettingsReadiness>
  preparation(): SettingsReadiness
  canSeal(revision: number, discard: boolean, restart: boolean): boolean
  seal(revision: number, discard: boolean, restart: boolean): boolean
  lost(message: string): void
  returnToApplication(): void
}
/** Page/run aggregates register owners independently of view mounting. */
export class DraftPreparationCoordinator implements DraftPreparationParticipant {
  private revision = 0
  private membership = 0
  private disposed = false
  private listeners = new Set<() => void>()
  private groups = new Map<DraftPreparationParticipant, { stop: () => void; users: number }>()
  constructor(groups: DraftPreparationParticipant[] = []) {
    for (const group of groups) this.add(group)
  }
  private changed = () => {
    this.revision++
    for (const listener of this.listeners) listener()
  }
  get size() { return this.groups.size }
  add(group: DraftPreparationParticipant): () => void {
    if (this.disposed) throw new Error("Cannot register with a disposed preparation owner.")
    const existing = this.groups.get(group)
    if (existing) existing.users++
    else {
      this.groups.set(group, { stop: group.subscribe(this.changed), users: 1 })
      this.membership++
      this.changed()
    }
    let released = false
    return () => {
      if (released) return
      released = true
      const entry = this.groups.get(group)
      if (!entry || --entry.users > 0) return
      entry.stop()
      this.groups.delete(group)
      this.membership++
      this.changed()
    }
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  preparation(): SettingsReadiness {
    const states = [...this.groups.keys()].map(group => group.preparation())
    return {
      revision: this.revision,
      draft: states.some((s) => s.draft),
      blocked: this.disposed ? "The preparation owner has ended." :
        states.flatMap((s) => (s.blocked ? [s.blocked] : [])).join("; ") || undefined,
    }
  }
  async prepare(): Promise<SettingsReadiness> {
    let membership: number
    do {
      membership = this.membership
      await Promise.all([...this.groups.keys()].map(group => group.prepare()))
    } while (!this.disposed && membership !== this.membership)
    return this.preparation()
  }
  private candidates(revision: number, discard: boolean, restart: boolean) {
    // Capture actual editor text before judging the aggregate revision.
    const candidates = [...this.groups.keys()].map(group => ({ group, state: group.preparation() }))
    return !this.disposed && revision === this.revision && candidates.every(({ group, state }) =>
      group.canSeal(state.revision, discard, restart)) && revision === this.revision ? candidates : undefined
  }
  canSeal(revision: number, discard: boolean, restart: boolean) {
    return this.candidates(revision, discard, restart) !== undefined
  }
  seal(revision: number, discard: boolean, restart: boolean) {
    const candidates = this.candidates(revision, discard, restart)
    if (!candidates) return false
    const attempted: DraftPreparationParticipant[] = []
    for (const { group, state } of candidates) {
      attempted.push(group)
      if (!this.groups.has(group) || !group.seal(state.revision, discard, restart)) {
        for (const previous of attempted) previous.returnToApplication()
        return false
      }
    }
    // Subscription callbacks can synchronously change membership or capture
    // newer text during sealing. Undo only the UI seal, never completed writes.
    if (revision !== this.revision) {
      for (const group of attempted) group.returnToApplication()
      return false
    }
    return true
  }
  lost(message: string) {
    for (const group of this.groups.keys()) group.lost(message)
  }
  returnToApplication() {
    for (const group of this.groups.keys()) group.returnToApplication()
  }
  dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const entry of this.groups.values()) entry.stop()
    this.groups.clear()
    this.membership++
    this.changed()
    this.listeners.clear()
  }
}
