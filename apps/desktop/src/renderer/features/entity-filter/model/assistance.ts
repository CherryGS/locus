import { ApiFailure, errorText, type BackendApi, type Wire } from "@/shared/api"
import { bytePosition, byteToRaw, displaySource, rawPosition } from "./raw-input"

export type AssistanceApi = Pick<BackendApi,
  "filterEditing" | "filterLiteral" | "filterHelp" | "searchObservation" |
  "searchStrings" | "searchBounds" | "releaseSearchObservation">
type Field = Wire<"Search_FieldDefinition">
type Candidate = { value: string; declared: boolean; observed: boolean }
type Session = { id: number; marker: number; end: number; confirmed: boolean; lookupRequested: boolean }

// Event provenance and one marker belong to the consumer. All native spans,
// references, fragments and serialization come from the source owner.
export class FilterAssistance {
  session?: Session
  context?: Wire<"FilterEditingData">
  help?: Wire<"FilterFieldHelpData">
  fields: Field[] = []
  observed: string[] = []
  bounds?: Wire<"SearchBoundsData">
  continuation?: string | null
  noValues = false
  loading = false
  editing = false
  error?: string
  helpError?: string
  highlight = 0
  lookupText = ""
  lookupFocused = false
  private lookupReplyError?: string
  selection?: { revision: number; position: number }
  private serial = 0
  private edit = 0
  private discovery = 0
  private helpSerial = 0
  private observation?: Wire<"SearchObservationData">
  private capturing?: Promise<Wire<"SearchObservationData">>
  private expiry?: ReturnType<typeof setTimeout>
  private helpKey?: string
  private locating?: Promise<void>
  private accepting?: Promise<boolean>
  private acceptanceIntent = 0
  private observationFailure?: string
  private caretPosition = 0
  private locationKey?: string
  constructor(
    private readonly api: AssistanceApi,
    private readonly source: () => Wire<"FilterSource">,
    private readonly write: (text: string) => void,
    private readonly changed: () => void,
    private readonly canEdit: () => boolean = () => true,
  ) {}
  get active() { return !!this.session }
  get locked() { return !this.canEdit() }
  get lookupAvailable() {
    return this.context?.kind === "field" || this.context?.kind === "value" && this.field?.assistance === "strings"
  }
  get lookupError() {
    try { new RegExp(this.lookupText, "iu") }
    catch (error) { return `Invalid regex: ${errorText(error)}` }
    return this.lookupReplyError
  }
  get activeRange() {
    if (!this.session) return undefined
    return { start: this.session.marker, end: this.session.end }
  }
  setLookup(text: string) {
    if (!this.session || this.locked || !this.lookupAvailable) return
    this.lookupText = text; this.lookupReplyError = undefined
    this.discovery++; this.acceptanceIntent++; this.highlight = 0
    this.continuation = undefined; this.loading = false
    this.updateHelp(); this.changed()
    if (!this.lookupError && this.context?.kind === "value") void this.readDiscovery()
  }
  get field() { return this.fields.find((f) => f.id === this.context?.field) }
  private get helpReference() {
    return this.context?.kind === "field" ? this.fieldCandidates[this.highlight]?.native_exact :
      this.context?.field ? this.context.reference || undefined : undefined
  }
  get fieldCandidates() {
    if (this.lookupError) return []
    const pattern = new RegExp(this.lookupText, "iu")
    return this.fields.filter((f) => [f.id, f.owner, f.native_exact, f.native_value]
      .some((s) => pattern.test(s)))
  }
  get candidates(): Candidate[] {
    if (this.lookupError || this.context?.kind !== "value" || !this.context.value_range) return []
    const pattern = new RegExp(this.lookupText, "iu")
    const values = new Map<string, Candidate>()
    // Declared choices remain separately available during a discovery outage.
    // Search owns observed matching; never label a choice absent based on a page.
    for (const value of this.observed)
      values.set(value, { value, declared: this.field?.choices?.values.includes(value) ?? false, observed: true })
    // Current owner-declared choices are ASCII format names. Keep observed
    // Search ordering and put an exact authored match first after merging.
    for (const value of this.field?.choices?.values ?? [])
      if (!values.has(value) && pattern.test(value))
        values.set(value, { value, declared: true, observed: false })
    const result = [...values.values()], exact = result.findIndex((c) => c.value === this.lookupText)
    if (exact > 0) result.unshift(...result.splice(exact, 1))
    return result
  }
  get candidateCount() {
    if (this.editing || this.loading || this.lookupError) return 0
    return this.context?.kind === "field" ? this.fieldCandidates.length : this.candidates.length
  }
  input(text: string, caret: number, freshMarker?: number) {
    if (!this.canEdit()) return
    const old = this.source().text
    if (this.session) {
      // A delayed eligibility reply must not take focus from a user who has
      // already continued deliberate native-source editing after the marker.
      if (text !== old) this.session.lookupRequested = false
      // Edits before/deleting the marker abandon assistance; a normal textarea
      // replacement/paste never resurrects a marker from its resulting text.
      let start = 0
      while (start < old.length && start < text.length && old[start] === text[start]) start++
      if (start <= this.session.marker && text !== old) this.exit()
      else this.session.end = Math.max(this.session.marker + 1, this.session.end + text.length - old.length)
    }
    this.write(text)
    if (!this.session && freshMarker !== undefined) {
      this.lookupText = ""; this.lookupReplyError = undefined; this.lookupFocused = false
      this.session = { id: ++this.serial, marker: freshMarker, end: rawPosition(text, caret), confirmed: false, lookupRequested: true }
      this.changed()
    }
    if (this.session) this.recontext(caret)
  }
  caret(position: number, end = position) {
    if (!this.session || this.locked) return
    const raw = rawPosition(this.source().text, position)
    if (raw < this.session.marker || raw > this.session.end || rawPosition(this.source().text, end) > this.session.end)
      this.exit()
    else this.recontext(position)
  }
  private recontext(position: number, force = false) {
    const key = JSON.stringify([this.session?.id, this.source(), position])
    if (!force && key === this.locationKey) return
    this.locationKey = key
    this.caretPosition = position
    this.locating = this.locate(position)
  }
  private async locate(caret: number) {
    const session = this.session
    if (!session) return
    const source = structuredClone(this.source()), ticket = ++this.edit
    // Keep the previous presentation while the owner resolves this edit. It is
    // not selectable until the current spans and observations have arrived.
    // Clearing it on every input/selection event made the popup collapse and
    // flip sides several times for a single keystroke.
    this.error = this.observationFailure
    this.editing = true
    this.loading = false
    this.discovery++
    this.highlight = 0
    this.changed()
    const current = () => this.session === session && ticket === this.edit &&
      JSON.stringify(source) === JSON.stringify(this.source())
    try {
      const marker = new TextEncoder().encode(source.text.slice(0, session.marker)).length
      let context = await this.api.filterEditing({ source, offset: bytePosition(source.text, caret), marker })
      if (!current()) return
      if (!context.field_range) {
        // Native multi-clause manual text has no safe value replacement. Recover
        // only its current field header for help, without inventing a value span.
        context = await this.api.filterEditing({ source, offset: marker + 1, marker })
        context = { ...context, kind: "indeterminate", value_range: null, fragment: "" }
      }
      if (!current()) return
      if (!context.field_range || context.field_range.start !== marker + 1) {
        this.exit()
        return
      }
      session.confirmed = true
      session.end = Math.max(session.end, byteToRaw(source.text, context.condition_range?.end ?? marker + 1))
      const previous = this.context
      if (!previous || previous.field !== context.field || previous.reference !== context.reference || previous.kind !== context.kind) {
        this.lookupText = ""; this.lookupReplyError = undefined
        this.observed = []; this.bounds = undefined; this.continuation = undefined; this.noValues = false
      }
      this.context = context
      this.editing = false
      this.updateHelp()
      if (this.field?.assistance === "bounds" || this.field?.assistance === "strings" && context.kind === "value")
        void this.readDiscovery()
      this.changed()
    } catch (error) {
      if (current()) {
        this.editing = false
        this.context = undefined; this.observed = []; this.bounds = undefined; this.continuation = undefined
        this.help = undefined; this.helpError = undefined; this.helpKey = undefined; this.helpSerial++
        this.error = `Editing assistance unavailable: ${errorText(error)}`
        this.changed()
      }
    }
  }
  private readHelp(reference?: string) {
    const session = this.session, source = this.source()
    const key = JSON.stringify([source.format, source.version, reference])
    if (this.helpKey === key) return
    this.helpKey = key
    this.help = undefined
    this.helpError = undefined
    const ticket = ++this.helpSerial
    void this.api.filterHelp({ format: source.format, version: source.version, field: reference })
      .then((help) => {
        if (this.session === session && ticket === this.helpSerial) { this.help = help; this.changed() }
      }).catch((error) => {
        if (this.session === session && ticket === this.helpSerial) {
          this.helpError = errorText(error); this.changed()
        }
      })
  }
  updateHelp() { if (this.session && this.context) this.readHelp(this.helpReference) }
  retryHelp() { this.helpKey = undefined; this.updateHelp() }
  private release(context?: string) {
    if (context) void this.api.releaseSearchObservation(context).catch(() => {})
  }
  private async capture() {
    if (this.observation) return this.observation
    if (this.capturing) return this.capturing
    const session = this.session, serial = this.serial
    const pending = this.api.searchObservation()
    this.capturing = pending
    try {
      const value = await pending
      if (this.session !== session || serial !== this.serial || this.capturing !== pending) {
        this.release(value.context)
        throw new Error("Discovery session ended.")
      }
      this.observation = value
      this.expiry = setTimeout(() => {
        this.observation = undefined
        this.discovery++
        this.observed = []; this.bounds = undefined; this.continuation = undefined; this.loading = false
        this.error = "Library observation expired. Refresh to try again."
        this.observationFailure = this.error
        this.release(value.context); this.changed()
      }, value.expires_after_seconds * 1000)
      return value
    } finally { if (this.capturing === pending) this.capturing = undefined }
  }
  async readDiscovery(more = false) {
    const session = this.session, context = this.context, field = this.field
    if (!session || !field || !context || this.editing || field.assistance === "manual") return
    if (this.lookupError) return
    if (this.observationFailure) return
    if (field.assistance === "strings" && (context.kind !== "value" || !context.value_range)) return
    const ticket = ++this.discovery, editing = this.edit, pattern = this.lookupText
    this.loading = true; this.error = undefined
    if (!more) this.noValues = false
    this.changed()
    const current = () => this.session === session && ticket === this.discovery && editing === this.edit
    try {
      const observation = await this.capture()
      if (!current()) return
      if (field.assistance === "bounds") {
        const bounds = await this.api.searchBounds({ context: observation.context, field: field.id })
        if (current()) this.bounds = bounds
      } else {
        const page = await this.api.searchStrings({ context: observation.context, field: field.id,
          fragment: pattern, matching: "regex", continuation: more ? this.continuation : undefined, limit: 40 })
        if (current()) {
          this.observed = more ? [...this.observed, ...page.values] : page.values
          this.continuation = page.continuation; this.noValues = page.no_values
        }
      }
    } catch (error) {
      if (current()) {
        if (error instanceof ApiFailure && error.detail.code === "invalid_request") {
          this.lookupReplyError = errorText(error)
          this.observed = []; this.continuation = undefined
          return
        }
        this.error = `Library observation unavailable: ${errorText(error)}. Refresh to try again.`
        this.observationFailure = this.error
        this.observed = []; this.bounds = undefined; this.continuation = undefined
        this.release(this.observation?.context); this.observation = undefined; clearTimeout(this.expiry)
      }
    } finally { if (current()) { this.loading = false; this.changed() } }
  }
  refresh() {
    this.observationFailure = undefined
    this.serial++
    this.release(this.observation?.context); this.observation = undefined
    this.capturing = undefined; clearTimeout(this.expiry)
    this.observed = []; this.bounds = undefined; this.continuation = undefined
    void this.readDiscovery()
  }
  retry() { if (!this.context) this.recontext(this.caretPosition, true); else this.refresh() }
  move(direction: number) {
    const count = this.candidateCount
    if (!count) return false
    this.highlight = (this.highlight + direction + count) % count
    if (this.context?.kind === "field") this.updateHelp()
    this.changed(); return true
  }
  acceptHighlighted() {
    if (this.editing || this.loading || this.lookupError) return false
    if (this.context?.kind === "field") {
      const field = this.fieldCandidates[this.highlight]
      if (field) { this.acceptField(field); return true }
    } else {
      const candidate = this.candidates[this.highlight]
      if (candidate) { void this.acceptValue(candidate.value); return true }
    }
    return false
  }
  private replace(range: Wire<"Search_SourceRange">, value: string, caretAdvance = 0) {
    const text = this.source().text, start = byteToRaw(text, range.start), end = byteToRaw(text, range.end)
    if (!this.session || start <= this.session.marker || end < start) throw new Error("No safe current replacement span.")
    const result = text.slice(0, start) + value + text.slice(end)
    this.session.end += value.length - (end - start)
    const position = displaySource(result.slice(0, start + value.length + caretAdvance)).length
    this.write(result)
    this.selection = { revision: this.edit + 1, position }
    this.recontext(position)
  }
  acceptField(field: Field) {
    if (!this.canEdit() || this.editing || this.lookupError) return
    const context = this.context
    if (!context?.field_range || context.kind !== "field" || !this.fieldCandidates.includes(field)) return
    try { this.replace(context.field_range, field.native_exact + (context.separator_range ? "" : ":"), context.separator_range ? 1 : 0) }
    catch (error) { this.error = errorText(error); this.changed() }
  }
  acceptValue(value: string) {
    if (!this.canEdit() || this.editing || this.loading || this.lookupError) return Promise.resolve(false)
    const pending = this.insertValue(value, ++this.acceptanceIntent)
    this.accepting = pending
    void pending.finally(() => { if (this.accepting === pending) this.accepting = undefined })
    return pending
  }
  private async insertValue(value: string, acceptance: number) {
    const context = this.context, session = this.session, source = structuredClone(this.source()), ticket = this.edit
    const candidate = this.candidates.find((c) => c.value === value), discovery = this.discovery, pattern = this.lookupText
    if (!context?.value_range || context.kind !== "value" || !context.reference || !candidate) return false
    try {
      const literal = await this.api.filterLiteral({ format: source.format, version: source.version,
        field: context.reference, value: { type: this.field?.field_type === "identifier" ? "identifier" : "text", value } })
      if (acceptance !== this.acceptanceIntent || this.session !== session || this.edit !== ticket || pattern !== this.lookupText || JSON.stringify(source) !== JSON.stringify(this.source())) return false
      if (candidate.observed && !candidate.declared && discovery !== this.discovery) {
        this.error = "The candidate observation changed. Select a current value to try again."; this.changed(); return false
      }
      this.replace(context.value_range, literal.literal)
      return true
    } catch (error) {
      if (acceptance === this.acceptanceIntent && this.session === session && this.edit === ticket) { this.error = errorText(error); this.changed() }
      return false
    }
  }
  async complete() {
    const session = this.session
    if (!session) return true
    if (this.accepting) {
      if (!await this.accepting) return false
    }
    while (!session.confirmed && this.session === session && this.locating) {
      const pending = this.locating
      await pending
      if (this.locating === pending) break
    }
    if (this.session !== session) return !this.session
    if (!session.confirmed) {
      this.error = "Editing context is unavailable. Source retained."
      this.changed(); return false
    }
    const text = this.source().text
    if (text[session.marker] !== "@") { this.error = "The helper marker moved. Source retained."; this.changed(); return false }
    const result = text.slice(0, session.marker) + text.slice(session.marker + 1)
    this.exit()
    this.write(result)
    return true
  }
  async enter(caret: number, end: number) {
    const session = this.session, text = this.source().text
    const result = await this.complete()
    if (result && session && !session.confirmed && !this.session && text === this.source().text) {
      const start = rawPosition(text, caret), finish = rawPosition(text, end)
      this.input(text.slice(0, start) + "\n" + text.slice(finish), caret + 1)
      this.selection = { revision: ++this.edit, position: caret + 1 }; this.changed()
    }
  }
  exit() {
    if (!this.session) return
    this.session = undefined; this.context = undefined; this.help = undefined; this.helpKey = undefined
    this.lookupText = ""; this.lookupReplyError = undefined; this.lookupFocused = false
    this.accepting = undefined; this.locating = undefined; this.selection = undefined
    this.locationKey = undefined
    this.acceptanceIntent++
    this.observed = []; this.bounds = undefined; this.continuation = undefined; this.noValues = false
    this.error = undefined; this.helpError = undefined; this.loading = false; this.editing = false; this.observationFailure = undefined
    this.edit++; this.discovery++; this.helpSerial++; this.serial++
    this.release(this.observation?.context); this.observation = undefined; this.capturing = undefined
    clearTimeout(this.expiry); this.changed()
  }
}
