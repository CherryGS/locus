import { errorText, type BackendApi } from "@/shared/api"
import type { FilterCoordinator } from "@/features/entity-filter"
import type { TagCoordinator } from "./tag-coordinator"

/** Management navigation belongs to this library/run, independently of route mounts. */
export class TagBrowsing {
  tagId?: string
  expanded = new Set<string>()
  lookup = ""
  scrollTop = 0
  pending = false
  error?: string
  private intent = 0
  private revision = 0
  private disposed = false
  private listeners = new Set<() => void>()
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  readonly snapshot = () => this.revision
  private readonly unobserve: () => void
  constructor(
    private readonly api: Pick<BackendApi, "filterLanguage" | "filterLiteral">,
    private readonly tags: TagCoordinator,
  ) {
    this.unobserve = tags.subscribe(() => {
      if (
        this.tagId &&
        tags.attempts.some(
          (a) =>
            a.state === "confirmed" &&
            a.change.operation === "delete" &&
            a.change.id === this.tagId,
        )
      )
        this.select(undefined)
    })
  }
  private changed() {
    if (!this.disposed) {
      this.revision++
      this.listeners.forEach((l) => l())
    }
  }
  select(id?: string) {
    if (this.tagId !== id) {
      this.suspend()
      this.tagId = id
      this.error = undefined
      this.changed()
    }
  }
  find(value: string) {
    this.lookup = value
    this.changed()
  }
  toggle(id: string) {
    if (this.expanded.has(id)) this.expanded.delete(id)
    else this.expanded.add(id)
    this.changed()
  }
  async content(inclusive: boolean, filter: FilterCoordinator, navigate: () => void) {
    if (!this.tagId || this.disposed || this.tags.hostClosing) return
    const receive = filter.generatedDraftReceiver()
    if (!receive) {
      this.error = "Filter is busy. Try again after its current action finishes."
      this.changed()
      return
    }
    const id = this.tagId,
      ticket = ++this.intent
    this.pending = true
    this.error = undefined
    this.changed()
    try {
      const language = await this.api.filterLanguage()
      if (this.disposed || ticket !== this.intent) return
      const literal = await this.api.filterLiteral({
        format: language.format,
        version: language.version,
        field: inclusive ? "tag_subtree" : "tag_ids",
        value: { type: "identifier", value: id },
      })
      if (this.disposed || ticket !== this.intent || this.tags.hostClosing) return
      if (!receive({ format: language.format, version: language.version, text: literal.condition }))
        throw new Error("Filter changed or is busy. Try again to open this Tag condition.")
      navigate()
    } catch (error) {
      if (!this.disposed && ticket === this.intent) this.error = errorText(error)
    } finally {
      if (!this.disposed && ticket === this.intent) {
        this.pending = false
        this.changed()
      }
    }
  }
  suspend() {
    this.intent++
    this.pending = false
    this.changed()
  }
  dispose() {
    this.disposed = true
    this.intent++
    this.unobserve()
    this.listeners.clear()
  }
}
