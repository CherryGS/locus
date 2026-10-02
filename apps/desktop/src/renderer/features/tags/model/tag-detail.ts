import { errorText, type BackendApi, type Wire } from "@/shared/api"
import type { IdentitySequence, GridPosition } from "@/entities/entity"
import type { TagAttempt, TagCoordinator } from "./tag-coordinator"

type Api = Pick<BackendApi, "tagDocument" | "filterLanguage" | "filterLiteral" | "search">
export type TagDetailState = {
  id: string
  document?: Wire<"TagDocument">
  documentPending: boolean
  documentError?: string
  editing: boolean
  draft?: string
  baseline?: string
  editorError?: string
  attempt?: TagAttempt
  work?: Promise<boolean>
  editor?: { read: () => string; readonly: (value: boolean) => void }
  editorVersion: number
  scope: boolean
  requestedScope: boolean
  sequence?: IdentitySequence
  entityId?: string
  grid?: GridPosition
  queryPending: boolean
  queryError?: string
  documentTicket: number
  queryTicket: number
}

/** Documents and complete Tag results are run-local consumers of existing owners. */
export class TagDetails {
  readonly states = new Map<string, TagDetailState>()
  private version = 0
  private live = true
  private sealed = false
  private listeners = new Set<() => void>()
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  readonly snapshot = () => this.version
  constructor(
    private api: Api,
    private tags: TagCoordinator,
  ) {}
  changed() {
    this.version++
    this.listeners.forEach((listener) => listener())
  }
  state(id: string) {
    let state = this.states.get(id)
    if (!state) {
      state = {
        id,
        documentPending: false,
        editing: false,
        editorVersion: 0,
        scope: false,
        requestedScope: false,
        queryPending: false,
        documentTicket: 0,
        queryTicket: 0,
      }
      this.states.set(id, state)
    }
    return state
  }
  get editable() {
    return this.live && !this.sealed && !this.tags.hostClosing
  }
  capture(state: TagDetailState) {
    if (!state.editing || !state.editor) return
    try {
      this.update(state, state.editor.read())
    } catch (error) {
      state.editorError = errorText(error)
      this.changed()
    }
  }
  dirty(state: TagDetailState) {
    this.capture(state)
    return state.editing && (state.draft !== state.baseline || !!state.editorError)
  }
  update(state: TagDetailState, markdown: string) {
    if (!state.editing || state.draft === markdown) return
    state.draft = markdown
    this.changed()
  }
  begin(state: TagDetailState) {
    if (!this.editable || !state.document || state.documentPending || this.unresolved(state)) return
    state.editing = true
    state.draft = state.document.markdown
    state.baseline = undefined
    state.editorError = undefined
    state.attempt = undefined
    state.editorVersion++
    this.changed()
  }
  mounted(state: TagDetailState, normalized: string) {
    if (state.editing && state.baseline === undefined) {
      state.baseline = normalized
      state.draft = normalized
      this.changed()
    }
  }
  unresolved(state: TagDetailState) {
    return (
      !!state.work || state.attempt?.state === "pending" || state.attempt?.state === "unconfirmed"
    )
  }
  discard(state: TagDetailState) {
    if (this.unresolved(state)) return false
    state.editing = false
    state.draft = undefined
    state.baseline = undefined
    state.editorError = undefined
    state.attempt = undefined
    state.editorVersion++
    this.changed()
    return true
  }
  async read(state: TagDetailState, adoptGuard = false) {
    if (!this.live) return
    const ticket = ++state.documentTicket
    state.documentPending = true
    state.documentError = undefined
    this.changed()
    try {
      const document = await this.api.tagDocument(state.id)
      if (!this.live || ticket !== state.documentTicket) return
      if (document.tag.id !== state.id) throw new Error("Document did not match the requested Tag.")
      if (!state.editing || adoptGuard) state.document = document
    } catch (error) {
      if (this.live && ticket === state.documentTicket) state.documentError = errorText(error)
    } finally {
      if (this.live && ticket === state.documentTicket) {
        state.documentPending = false
        this.changed()
      }
    }
  }
  save(state: TagDetailState): Promise<boolean> {
    if (state.work) return state.work
    if (!this.editable || !state.document || this.unresolved(state) || state.editorError)
      return Promise.resolve(false)
    this.capture(state)
    if (state.editorError) return Promise.resolve(false)
    if (!this.dirty(state)) {
      this.discard(state)
      return Promise.resolve(true)
    }
    const markdown = state.draft!
    state.editor?.readonly(true)
    const work = this.tags
      .write(
        { operation: "markdown", id: state.id, revision: state.document.tag.revision, markdown },
        `Save ${state.document.tag.name} document`,
      )
      .then((attempt) => {
        if (attempt) state.attempt = attempt
        return this.accept(state)
      })
      .finally(() => {
        state.work = undefined
        state.editor?.readonly(!state.editing || !this.editable || this.unresolved(state))
        this.changed()
      })
    state.work = work
    this.changed()
    return work
  }
  private accept(state: TagDetailState) {
    const attempt = state.attempt
    if (attempt?.state !== "confirmed" || attempt.change.operation !== "markdown" || !attempt.saved)
      return false
    state.document = { tag: attempt.saved, markdown: attempt.change.markdown }
    state.editing = false
    state.draft = undefined
    state.baseline = undefined
    state.editorVersion++
    this.changed()
    return true
  }
  async recover(state: TagDetailState) {
    if (!state.attempt || state.work || !this.live) return
    await this.tags.recover(state.attempt)
    this.accept(state)
    state.editor?.readonly(!state.editing || !this.editable || this.unresolved(state))
    this.changed()
  }
  async query(state: TagDetailState, inclusive = state.requestedScope) {
    if (!this.editable) return
    const ticket = ++state.queryTicket
    state.requestedScope = inclusive
    state.queryPending = true
    state.queryError = undefined
    this.changed()
    try {
      const language = await this.api.filterLanguage()
      if (!this.live || ticket !== state.queryTicket) return
      const literal = await this.api.filterLiteral({
        format: language.format,
        version: language.version,
        field: inclusive ? "tag_subtree" : "tag_ids",
        value: { type: "identifier", value: state.id },
      })
      if (!this.live || ticket !== state.queryTicket) return
      const observation = await this.api.search({
        format: language.format,
        version: language.version,
        text: literal.condition,
      })
      // Identity membership remains valid after releasing optional explanation context.
      void observation.release().catch(() => {})
      if (!this.live || ticket !== state.queryTicket) return
      state.sequence = observation.entities
      if (!state.entityId || state.sequence.indexOf(state.entityId) < 0)
        state.entityId = state.sequence.at(0)
      state.scope = inclusive
    } catch (error) {
      if (this.live && ticket === state.queryTicket) state.queryError = errorText(error)
    } finally {
      if (this.live && ticket === state.queryTicket) {
        state.queryPending = false
        this.changed()
      }
    }
  }
  suspend(state: TagDetailState) {
    state.queryTicket++
    state.queryPending = false
    this.changed()
  }
  selectEntity(state: TagDetailState, id: string) {
    if (!state.sequence || state.sequence.indexOf(id) < 0 || state.entityId === id) return
    state.entityId = id
    this.changed()
  }
  async prepare() {
    for (const state of this.states.values()) this.capture(state)
    await Promise.all(
      [...this.states.values()].flatMap((state) => (state.work ? [state.work] : [])),
    )
    return this.preparation()
  }
  preparation() {
    const states = [...this.states.values()]
    const dirty = states.map((state) => this.dirty(state)).some(Boolean)
    return {
      revision: this.version,
      draft: dirty,
      blocked: states.some((state) => this.unresolved(state))
        ? "A Tag document save is unconfirmed. Return to its page to recover the original request."
        : !this.live && dirty
          ? "Backend unavailable; Tag document text is unsaved."
          : undefined,
    }
  }
  canSeal(revision: number, discard: boolean, restart: boolean) {
    const state = this.preparation()
    return revision === state.revision && (!state.draft || discard) && (!restart || !state.blocked)
  }
  seal(revision: number, discard: boolean, restart: boolean) {
    if (!this.canSeal(revision, discard, restart)) return false
    this.sealed = true
    for (const state of this.states.values()) state.editor?.readonly(true)
    return true
  }
  returnToApplication() {
    this.sealed = false
    for (const state of this.states.values())
      state.editor?.readonly(!state.editing || !this.editable || this.unresolved(state))
    this.changed()
  }
  lost(message: string) {
    if (!this.live) return
    for (const state of this.states.values()) {
      this.capture(state)
      state.documentTicket++
      state.queryTicket++
      state.documentPending = false
      state.queryPending = false
      state.documentError = message
      state.editor?.readonly(true)
    }
    this.live = false
    this.changed()
  }
  dispose() {
    this.lost("The library session ended.")
    this.listeners.clear()
  }
}
