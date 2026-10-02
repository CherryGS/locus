import { diagnosticText, errorText, type BackendApi } from "@/shared/api"

export type NotesState = {
  id: string
  draft: string
  saved?: string
  reading: boolean
  composing?: boolean
  error?: string
  attempt?: { request_id: string; notes: string }
  work?: Promise<void>
  timer?: ReturnType<typeof setTimeout>
}

// Session-owned drafts survive panel/Entity navigation. Each save captures its
// Entity and text; subsequent typing is serialized behind that request.
export class EntityNotesCoordinator {
  private states = new Map<string, NotesState>()
  private listeners = new Set<() => void>()
  private version = 0
  private live = true
  private sealed = false
  private closing = false
  constructor(private api: BackendApi) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  snapshot = () => this.version
  private changed() {
    this.version++
    this.listeners.forEach((listener) => listener())
  }
  get editable() { return this.live && !this.sealed && !this.closing }
  get(id: string) {
    let state = this.states.get(id)
    if (!state) {
      state = { id, draft: "", reading: false }
      this.states.set(id, state)
    }
    return state
  }
  async read(state: NotesState) {
    if (!this.live || state.reading || state.work || state.attempt ||
      (state.saved !== undefined && state.draft !== state.saved)) return
    state.reading = true
    state.error = undefined
    this.changed()
    try {
      const result = await this.api.entityNotes(state.id)
      if (!this.live) return
      if (result.entity_id !== state.id) throw new Error("Notes belong to another Entity.")
      state.saved = state.draft = result.notes
    } catch (error) {
      if (this.live) state.error = errorText(error)
    } finally {
      state.reading = false
      this.changed()
    }
  }
  update(state: NotesState, draft: string, composing = false) {
    if (!this.editable || state.saved === undefined || state.reading) return
    state.draft = draft
    state.composing = composing
    clearTimeout(state.timer)
    if (!composing && !state.error) state.timer = setTimeout(() => void this.save(state), 650)
    this.changed()
  }
  save(state: NotesState): Promise<void> {
    clearTimeout(state.timer)
    if (state.work) return state.work
    if (!this.live || this.sealed || state.composing || state.saved === undefined ||
      (!state.attempt && state.draft === state.saved)) return Promise.resolve()
    const attempt = state.attempt ?? { request_id: crypto.randomUUID(), notes: state.draft }
    state.attempt = attempt
    state.error = undefined
    // Start after work is assigned, including synchronous transport failures.
    state.work = Promise.resolve().then(async () => {
      try {
        const result = await this.api.writeEntityNotes(state.id, attempt)
        if (!this.live) return
        if (result.status === "failed") {
          state.attempt = undefined
          throw new Error(diagnosticText(result.diagnostic))
        }
        if (result.status !== "entity_notes_saved" || result.notes.entity_id !== state.id ||
          result.notes.notes !== attempt.notes) throw new Error("The notes save could not be confirmed.")
        state.saved = result.notes.notes
        state.attempt = undefined
      } catch (error) {
        if (this.live) state.error = errorText(error)
      } finally {
        state.work = undefined
        this.changed()
      }
      if (this.live && !state.error && state.draft !== state.saved) await this.save(state)
    })
    this.changed()
    return state.work
  }
  async prepare() {
    await Promise.all([...this.states.values()].map((state) => this.save(state)))
    return this.preparation()
  }
  preparation() {
    const states = [...this.states.values()]
    return {
      revision: this.version,
      draft: states.some((state) => state.saved !== undefined && state.draft !== state.saved),
      blocked: states.some((state) => state.attempt)
        ? "An Entity notes save is unconfirmed. Return to Overview and retry the save."
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
    return true
  }
  returnToApplication() { this.sealed = false; this.changed() }
  host(closing: boolean) {
    if (this.closing === closing) return
    this.closing = closing
    this.changed()
  }
  lost() {
    if (!this.live) return
    this.live = false
    for (const state of this.states.values()) {
      clearTimeout(state.timer)
      if (state.draft !== state.saved || state.attempt) state.error = "Connection ended. These notes have not been confirmed saved."
    }
    this.changed()
  }
  dispose() { this.lost(); this.listeners.clear() }
}
