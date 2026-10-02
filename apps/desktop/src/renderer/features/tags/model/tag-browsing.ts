import type { IdentitySequence } from "@/entities/entity"
import { errorText, type BackendApi, type Wire } from "@/shared/api"
import type { TagCoordinator } from "./tag-coordinator"

type TagBrowseApi = Pick<
  BackendApi,
  "filterLanguage" | "filterLiteral" | "search"
>

/** One session retains its last Tag result; main Filter state is never written. */
export class TagBrowsing {
  tagId?: string
  sequence?: IdentitySequence
  pending = false
  error?: string
  missing = false
  stale = false
  private intent = 0
  private revision = 0
  private disposed = false
  private vocabulary?: Wire<"TagRecord">[]
  private confirmed = new Set<string>()
  private listeners = new Set<() => void>()
  private unobserve: () => void
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  readonly snapshot = () => this.revision
  constructor(
    private readonly api: TagBrowseApi,
    private readonly tags: TagCoordinator,
    private readonly replaced: () => void,
  ) {
    this.vocabulary = tags.vocabulary
    this.confirmed = new Set(
      tags.attempts
        .filter((a) => a.state === "confirmed")
        .map((a) => a.request),
    )
    this.unobserve = tags.subscribe(() => this.observeVocabulary())
  }
  get resumeId() {
    return this.missing ? undefined : this.tagId
  }
  private changed() {
    if (this.disposed) return
    this.revision++
    this.listeners.forEach((listener) => listener())
  }
  private observeVocabulary() {
    if (this.disposed) return
    if (this.vocabulary !== this.tags.vocabulary && !this.tags.readError) {
      this.vocabulary = this.tags.vocabulary
      if (
        this.tagId &&
        this.vocabulary &&
        !this.vocabulary.some((tag) => tag.id === this.tagId)
      ) {
        this.intent++
        this.missing = true
        this.sequence = undefined
        this.stale = false
        this.pending = false
        this.error = undefined
      }
    }
    for (const attempt of this.tags.attempts) {
      if (attempt.state !== "confirmed" || this.confirmed.has(attempt.request))
        continue
      this.confirmed.add(attempt.request)
      const change = attempt.change
      if (
        (change.operation === "add" || change.operation === "remove") &&
        change.tag_id === this.tagId
      )
        this.stale = !!this.sequence
      if (change.operation === "delete" && change.id === this.tagId) {
        this.intent++
        this.missing = true
        this.sequence = undefined
        this.stale = false
        this.error = undefined
        this.pending = false
      }
    }
    this.changed()
  }
  select(id?: string) {
    if (this.disposed) return
    if (id !== this.tagId) {
      this.intent++
      this.tagId = id
      this.sequence = undefined
      this.pending = false
      this.error = undefined
      this.missing = false
      this.stale = false
      this.changed()
    }
    if (id && !this.sequence && !this.pending && !this.missing)
      void this.refresh()
  }
  async refresh() {
    if (this.disposed || this.tags.hostClosing || !this.tagId || this.missing)
      return
    const id = this.tagId,
      ticket = ++this.intent
    this.pending = true
    this.error = undefined
    this.changed()
    try {
      await this.tags.read()
      if (this.disposed || ticket !== this.intent) return
      const language = await this.api.filterLanguage()
      const literal = await this.api.filterLiteral({
        format: language.format,
        version: language.version,
        field: "tag_ids",
        value: { type: "identifier", value: id },
      })
      if (this.disposed || ticket !== this.intent) return
      const observation = await this.api.search({
        format: language.format,
        version: language.version,
        text: literal.condition,
      })
      // The page needs identities, not pinned match evidence. Release even a superseded result.
      void observation.release().catch(() => {})
      if (this.disposed || ticket !== this.intent) return
      this.sequence = observation.entities
      this.stale = false
      this.replaced()
    } catch (error) {
      if (!this.disposed && ticket === this.intent)
        this.error = errorText(error)
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
    this.sequence = undefined
  }
}
