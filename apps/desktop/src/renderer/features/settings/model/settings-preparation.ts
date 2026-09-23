import type { SettingsCoordinator, SettingsPreparation } from "./settings-coordinator"
type Group = Pick<
  SettingsCoordinator,
  "subscribe" | "prepare" | "preparation" | "canSeal" | "seal" | "lost" | "returnToApplication"
>
/** The two active Settings consumers share one native close/restart handshake. */
export class SettingsPreparationCoordinator {
  private revision = 0
  private listeners = new Set<() => void>()
  constructor(private groups: Group[]) {
    for (const group of groups)
      group.subscribe(() => {
        this.revision++
        for (const listener of this.listeners) listener()
      })
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
    return (
      revision === this.revision &&
      this.groups.every((group) => group.canSeal(group.preparation().revision, discard, restart))
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
