import { errorText, type BackendApi, type Wire } from "@/shared/api"
import type { TagCoordinator } from "./tag-coordinator"

export type GeneratedDraftReceiver = () => ((source: Wire<"FilterSource">) => boolean) | undefined

/** Management navigation belongs to this library/run, independently of route mounts. */
export class TagBrowsing {
  tagId?: string
  // The open branch survives selecting an ancestor within that same path.
  branchId?: string
  lookup = ""
  scrollLeft = 0
  columnScroll = new Map<string, number>()
  lookupScrollTop = 0
  revealSelection = false
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
      if (!tags.vocabulary) return
      const byId = new Map(tags.vocabulary.map((tag) => [tag.id, tag])),
        selected = this.tagId && byId.has(this.tagId) ? this.tagId : undefined,
        branch = this.branchId && byId.has(this.branchId) ? this.branchId : undefined,
        next = branch && (!selected || this.onBranch(selected, branch)) ? branch : selected
      if (next !== this.branchId) {
        this.branchId = next
        this.changed()
      }
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
      if (id && !this.onBranch(id, this.branchId)) this.branchId = id
      this.tagId = id
      this.revealSelection = !!id
      this.error = undefined
      this.changed()
    }
  }
  locate(id: string) {
    this.select(id)
    this.revealSelection = true
    this.changed()
  }
  private onBranch(id: string, tip?: string) {
    const byId = new Map((this.tags.vocabulary ?? []).map((tag) => [tag.id, tag]))
    let current = tip
    while (current) {
      if (current === id) return true
      current = byId.get(current)?.parent ?? undefined
    }
    return false
  }
  find(value: string) {
    this.lookup = value
    this.changed()
  }
  async content(inclusive: boolean, generatedDraftReceiver: GeneratedDraftReceiver, navigate: () => void) {
    if (!this.tagId || this.disposed || this.tags.hostClosing) return
    const receive = generatedDraftReceiver()
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
      if (
        !receive({
          format: language.format,
          version: language.version,
          text: literal.condition,
        })
      )
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
