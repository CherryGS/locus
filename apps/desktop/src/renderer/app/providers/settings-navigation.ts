export type SettingsCategory = "external" | "media"
type Visit = { pathname: string; state: { __TSR_key?: string; __TSR_index: number } }
type Entry = { index: number; key: string }

/** References to actual history entries, never a second navigation stack. */
export class SettingsNavigation {
  category: SettingsCategory = "external"
  private entries = new Map<string, { index: number; entry?: Entry }>()
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
  observe(previous: Visit, next: Visit, action: string) {
    const index = next.state.__TSR_index
    const key = next.state.__TSR_key
    if (action === "PUSH") {
      // New navigation discards the browser's forward branch and its references.
      for (const [key, visit] of this.entries) if (visit.index >= index) this.entries.delete(key)
      if (next.pathname === "/setting" && key) {
        this.entries.set(key, {
          index,
          entry:
            previous.pathname !== "/setting" && previous.state.__TSR_key
              ? { index: previous.state.__TSR_index, key: previous.state.__TSR_key }
              : undefined,
        })
      }
    } else if (action === "REPLACE") {
      // Router REPLACE retains the index but assigns a new key.
      const oldKey = previous.state.__TSR_key
      const old = oldKey ? this.entries.get(oldKey) : undefined
      if (oldKey) {
        this.entries.delete(oldKey)
        for (const visit of this.entries.values()) if (visit.entry?.key === oldKey) visit.entry = undefined
      }
      if (old && key && next.pathname === "/setting") this.entries.set(key, old)
    }
    this.changed()
  }
  returnDelta(current: Visit) {
    const entry = current.state.__TSR_key && this.entries.get(current.state.__TSR_key)?.entry
    return entry && entry.index < current.state.__TSR_index
      ? entry.index - current.state.__TSR_index
      : undefined
  }
}
