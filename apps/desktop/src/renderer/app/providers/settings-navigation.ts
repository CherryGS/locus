export type SettingsCategory = "library" | "external" | "media"
/** Session-local settings workspace, independent of page navigation. */
export class SettingsNavigation {
  category: SettingsCategory = "external"
  opened = false
  private listeners = new Set<() => void>()
  private version = 0
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  readonly snapshot = () => this.version
  private changed() {
    this.version++
    this.listeners.forEach((listener) => listener())
  }
  select(category: SettingsCategory) {
    this.category = category
    this.changed()
  }
  setOpen(open: boolean) {
    if (this.opened === open) return
    this.opened = open
    this.changed()
  }
}
