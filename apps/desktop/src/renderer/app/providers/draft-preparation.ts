import type { SettingsReadiness } from "../../../shared/desktop-bridge"

interface DraftPreparationParticipant {
  subscribe(listener: () => void): () => void
  prepare(): Promise<SettingsReadiness>
  preparation(): SettingsReadiness
  canSeal(revision: number, discard: boolean, restart: boolean): boolean
  seal(revision: number, discard: boolean, restart: boolean): boolean
  lost(message: string): void
  returnToApplication(): void
}
/** Renderer draft consumers share one revision-bound native preparation report. */
export class DraftPreparationCoordinator {
  private revision = 0
  private listeners = new Set<() => void>()
  constructor(private groups: DraftPreparationParticipant[]) {
    for (const group of groups) this.observe(group)
  }
  private observe(group: DraftPreparationParticipant) {
    group.subscribe(() => {
      this.revision++
      for (const listener of this.listeners) listener()
    })
  }
  add(group: DraftPreparationParticipant) {
    this.groups.push(group)
    this.observe(group)
    this.revision++
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  async prepare(): Promise<SettingsReadiness> {
    await Promise.all(this.groups.map((group) => group.prepare()))
    const states = this.groups.map((group) => group.preparation())
    return {
      revision: this.revision,
      draft: states.some((s) => s.draft),
      blocked: states.flatMap((s) => (s.blocked ? [s.blocked] : [])).join("; ") || undefined,
    }
  }
  canSeal(revision: number, discard: boolean, restart: boolean) {
    // A document participant captures synchronous editor text here, before a
    // debounced notification. Observe all revisions before checking consent.
    const states = this.groups.map((group) => group.preparation())
    return (
      revision === this.revision &&
      this.groups.every((group, index) =>
        group.canSeal(states[index].revision, discard, restart),
      ) &&
      revision === this.revision
    )
  }
  seal(revision: number, discard: boolean, restart: boolean) {
    if (!this.canSeal(revision, discard, restart)) return false
    return this.groups.every((group) => group.seal(group.preparation().revision, discard, restart))
  }
  lost(message: string) {
    for (const group of this.groups) group.lost(message)
  }
  returnToApplication() {
    for (const group of this.groups) group.returnToApplication()
  }
}
