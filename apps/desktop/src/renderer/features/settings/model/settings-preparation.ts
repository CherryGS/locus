import type { SettingsCoordinator, SettingsPreparation } from "./settings-coordinator"
type Group = Pick<
  SettingsCoordinator,
  "subscribe" | "prepare" | "preparation" | "canSeal" | "seal" | "lost" | "returnToApplication"
>
/** Renderer draft consumers share one revision-bound native preparation report. */
export class SettingsPreparationCoordinator {
  private revision = 0
  private listeners = new Set<() => void>()
  constructor(private groups: Group[]) {
    for (const group of groups) this.observe(group)
  }
  private observe(group: Group) {
    group.subscribe(() => {
      this.revision++
      for (const listener of this.listeners) listener()
    })
  }
  add(group: Group) {
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
  async prepare(): Promise<SettingsPreparation> {
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
