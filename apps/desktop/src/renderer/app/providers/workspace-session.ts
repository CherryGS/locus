import { FilterCoordinator, type EstablishedFilterResult } from "@/features/entity-filter"
import { EntityNotesCoordinator } from "@/features/entity-notes"
import { PlaybackCoordinator } from "@/features/video-playback"
import { emptySequence, suppliedSequence, entityLabel, type EntitySource } from "@/entities/entity"
import type { EntityBrowsingState, EntityDestination, RelatedCollection, CivitaiSelection } from "@/pages/entity"
import type { Wire } from "@/shared/api"
import type { DesktopState, SettingsReadiness } from "../../../shared/desktop-bridge"
import { createPageRouter, type PageRouter } from "../router"
import { DraftPreparationCoordinator } from "./draft-preparation"
import type { LibrarySession } from "./library-session"

export type PageCategory = "Media" | "Models" | "All content" | "Tags"
const scopes = {
  Media: 'entity_kinds:"aadf84d2-0dc0-4a81-8cdb-901162c78321" OR entity_kinds:"f4be9375-60f1-4d04-8f07-8c9ad765e230"',
  Models: 'entity_kinds:"6c46d4eb-5c2f-46eb-9e81-f866884e3107"',
  "All content": undefined,
  Tags: undefined,
}

/** One logical page, independent of whether its current DOM is visible. */
export class LibraryPageSession {
  readonly browsing = new Map<string, EntityBrowsingState>()
  readonly relatedCollections = new Map<string, RelatedCollection>()
  readonly civitaiExcursions = new Map<string, CivitaiSelection>()
  readonly filter: FilterCoordinator
  readonly notes: EntityNotesCoordinator
  readonly playback: PlaybackCoordinator
  readonly preparation: DraftPreparationCoordinator
  readonly router: PageRouter
  mainDestination: EntityDestination = { mode: "grid", collectionId: "library" }
  contextTitle?: string
  active = false
  private wanted: string[] = []
  private readonly scopedReader
  private readonly preferenceDemand
  private readonly coverDemand
  private unregister?: () => void
  private unobserveHistory: () => void
  private unobserveFeatures: (() => void)[] = []
  constructor(readonly run: LibrarySession, readonly id: string, readonly category: PageCategory,
    readonly label: string, entry?: string) {
    this.scopedReader = run.reader.scoped()
    this.preferenceDemand = run.preferences.acquireDemand()
    this.coverDemand = run.covers.acquireDemand()
    this.filter = new FilterCoordinator(run.api, () => run.reader.resultReplaced(this.active ? this.wanted : []), scopes[category])
    this.notes = new EntityNotesCoordinator(run.api, run.notesWrites)
    this.playback = new PlaybackCoordinator(run.audio)
    this.preparation = new DraftPreparationCoordinator(category === "Tags"
      ? [this.filter, this.notes, run.tagDetails] : [this.filter, this.notes])
    this.router = createPageRouter(entry ?? (category === "Tags" ? "/tags" : undefined))
    this.unobserveHistory = this.router.history.subscribe(() => { run.workspace.navigationRevision++ })
    this.unobserveFeatures = [this.notes.subscribe(() => run.workspace.notify()), this.filter.subscribe(() => run.workspace.notify())]
    if (category === "Tags") this.unobserveFeatures.push(run.tagDetails.subscribe(() => run.workspace.notify()))
  }
  get reader() { return this.scopedReader.reader }
  get api() { return this.run.api }
  get preferences() { return this.run.preferences }
  get covers() { return this.run.covers }
  get tags() { return this.run.tags }
  get tagBrowsing() { return this.run.tagBrowsing }
  get tagDetails() { return this.run.tagDetails }
  get civitai() { return this.run.civitai }
  get imports() { return this.run.imports }
  get tasks() { return this.run.tasks }
  get bridge() { return this.run.bridge }
  get initial() { return this.run.initial }
  get settings() { return this.run.settings }
  get settingsNavigation() { return this.run.settingsNavigation }
  get externalSettings() { return this.run.externalSettings }
  get externalToken() { return this.run.externalToken }
  get = (id: string) => {
    const entity = this.reader.get(id)
    return { ...entity, components: entity.components.map(component => component.kind === "civitai"
      ? { ...component, thumbnail: this.covers.get(id).preview } : component),
      problems: [...entity.problems ?? [], ...this.preferences.problems(id)] }
  }
  demand = (ids: string[]) => { this.wanted = ids; if (this.active) this.updateDemand(ids) }
  private updateDemand(ids: string[]) {
    this.reader.demand(ids)
    this.preferenceDemand.update(ids)
    this.coverDemand.update(ids)
  }
  get attention() {
    const notes = this.notes.issues().find(state => state.error || state.attempt && !state.work)
    if (notes) return { kind: "notes" as const, subject: notes.id }
    if (this.filter.uncertainWrites.length || this.filter.preparation().draft) return { kind: "filter" as const }
    if (this.category === "Tags") {
      const state = [...this.tagDetails.states.values()].find(state => this.tagDetails.dirty(state) || this.tagDetails.unresolved(state))
      if (state) return { kind: "tag" as const, subject: state.id }
    }
  }
  source(): EntitySource { return { sequence: this.filter.sequence ?? emptySequence, get: this.get, demand: this.demand } }
  activate(active: boolean) {
    if (this.active === active) return
    this.active = active
    if (!active) {
      this.playback.deactivate()
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    }
    const search = this.router.state.location.search as Partial<EntityDestination>
    this.updateDemand(active ? this.wanted : search.mode === "inspect" && search.entityId ? [search.entityId] : [])
  }
  open() { this.preparation.returnToApplication(); this.unregister ??= this.run.draftPreparation.add(this.preparation) }
  detach() { this.activate(false); this.updateDemand([]); this.unregister?.(); this.unregister = undefined }
  dispose() {
    this.detach()
    this.filter.dispose()
    this.notes.dispose()
    this.playback.dispose()
    this.scopedReader.release()
    this.preferenceDemand.release()
    this.coverDemand.release()
    this.preparation.dispose()
    this.unobserveHistory()
    for (const stop of this.unobserveFeatures) stop()
  }
}

export class WorkspaceSession {
  pages: LibraryPageSession[] = []
  activeId?: string
  close?: { page: LibraryPageSession; ticket: number; pending: boolean; state?: SettingsReadiness; error?: string }
  navigationRevision = 0
  initialEntryHandled = false
  private revision = 0
  private serial = 0
  private closeTicket = 0
  private counts = new Map<PageCategory, number>()
  private mru: string[] = []
  private tagsPage?: LibraryPageSession
  private closing = false
  private listeners = new Set<() => void>()
  constructor(readonly run: LibrarySession) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  snapshot = () => this.revision
  private changed() { this.revision++; this.listeners.forEach(listener => listener()) }
  notify() { this.changed() }
  get active() { return this.pages.find(page => page.id === this.activeId) }
  private append(page: LibraryPageSession) {
    page.open()
    this.pages = [...this.pages, page]
    this.activate(page.id)
    return page
  }
  open(category: PageCategory) {
    if (category === "Tags" && this.tagsPage) {
      if (!this.pages.includes(this.tagsPage)) this.append(this.tagsPage)
      else this.activate(this.tagsPage.id)
      return this.tagsPage
    }
    const page = new LibraryPageSession(this.run, `page-${++this.serial}`, category, this.nextLabel(category))
    if (category === "Tags") this.tagsPage = page
    this.append(page)
    if (category !== "Tags") page.filter.start()
    return page
  }
  private nextLabel(category: PageCategory) {
    const number = (this.counts.get(category) ?? 0) + 1
    this.counts.set(category, number)
    return number === 1 || category === "Tags" ? category : `${category} ${number}`
  }
  activate(id: string) {
    if (!this.pages.some(page => page.id === id)) return
    this.navigationRevision++
    this.activeId = id
    this.mru = [id, ...this.mru.filter(value => value !== id)]
    for (const page of this.pages) page.activate(page.id === id)
    this.changed()
  }
  direct(id: string, title?: string) {
    const search: EntityDestination = { mode: "inspect", collectionId: "direct", entityId: id, direct: true }
    const page = new LibraryPageSession(this.run, `page-${++this.serial}`, "All content",
      title ?? entityLabel(this.run.get(id)), `/entity?${new URLSearchParams({ mode: "inspect", collectionId: "direct", entityId: id, direct: "true" })}`)
    // Use the router's normal serializer for booleans, with a single initial visit.
    page.router.history.replace(page.router.buildLocation({ to: "/entity", search }).href)
    page.filter.adopt({ sequence: suppliedSequence([id]) })
    return this.append(page)
  }
  handoff(source: LibraryPageSession, destination: EntityDestination, sequence: EntitySource["sequence"], title?: string, suppliedResult?: EstablishedFilterResult) {
    const category = source.category === "Tags" ? "All content" : source.category
    const page = new LibraryPageSession(this.run, `page-${++this.serial}`, category, this.nextLabel(category))
    page.contextTitle = title
    if (suppliedResult) page.filter.adopt(suppliedResult)
    else if (source.filter.established && source.category !== "Tags") page.filter.adopt(source.filter.established)
    else page.filter.adopt({ sequence })
    // Retain only the actual result/source chain. Unrelated earlier galleries
    // are another page's browsing context and may hold large identity arrays.
    let context: EntityDestination | undefined = destination
    while (context) {
      const collection = source.relatedCollections.get(context.collectionId)
      if (collection) page.relatedCollections.set(collection.id, collection)
      context = context.source
    }
    page.router.history.replace(page.router.buildLocation({ to: "/entity", search: destination }).href)
    return this.append(page)
  }
  generatedDraftReceiver = () => {
    const navigation = this.navigationRevision
    return (source: Wire<"FilterSource">) => {
      if (navigation !== this.navigationRevision) return false
      const page = this.open("All content")
      page.filter.draft = { name: "", source: structuredClone(source) }
      page.filter.show()
      return true
    }
  }
  async requestClose(page: LibraryPageSession) {
    if (!this.pages.includes(page)) return
    const ticket = ++this.closeTicket
    const current = page.preparation.preparation()
    if (!current.blocked && !current.draft) {
      // A clean page still seals the current revision, but never enters a
      // visible confirmation state just to complete on the next microtask.
      this.close = { page, ticket, pending: false, state: current }
      this.finishClose(false)
      return
    }
    this.close = { page, ticket, pending: true }
    this.changed()
    const state = await page.preparation.prepare()
    if (this.close?.ticket !== ticket) return
    this.close = { page, ticket, pending: false, state }
    if (!state.blocked && !state.draft) this.finishClose(false)
    else this.changed()
  }
  cancelClose() { this.closeTicket++; this.close?.page.preparation.returnToApplication(); this.close = undefined; this.changed() }
  finishClose(discard: boolean) {
    const close = this.close
    if (!close?.state || close.pending || close.state.blocked) return false
    const { page, state } = close
    if (!page.preparation.canSeal(state.revision, discard, true) || !page.preparation.seal(state.revision, discard, true)) {
      void this.requestClose(page)
      return false
    }
    if (discard) page.notes.discard()
    if (discard && page.category === "Tags") for (const state of page.tagDetails.states.values()) page.tagDetails.discard(state)
    const wasActive = this.activeId === page.id
    page.detach()
    this.pages = this.pages.filter(value => value !== page)
    this.mru = this.mru.filter(id => id !== page.id)
    this.close = undefined
    if (page.category !== "Tags") page.dispose()
    if (wasActive) {
      this.activeId = undefined
      if (this.mru[0]) this.activate(this.mru[0])
    }
    this.changed()
    const navigation = this.navigationRevision
    if (wasActive) requestAnimationFrame(() => {
      // Closing no longer relies on a transient dialog's final-focus handler.
      // Do not override a newer tab/navigation action while React commits.
      if (navigation === this.navigationRevision)
        document.getElementById(this.activeId ? `workspace-tab-${this.activeId}` : "locus-launcher")?.focus()
    })
    return true
  }
  async saveClose() {
    const close = this.close
    if (!close) return
    const page = close.page
    if (page.filter.preparation().draft) { page.filter.show(); await page.filter.save() }
    if (page.category === "Tags") for (const state of page.tagDetails.states.values()) if (page.tagDetails.dirty(state)) await page.tagDetails.save(state)
    if (this.close === close) await this.requestClose(page)
  }
  resolveAttention(page: LibraryPageSession) {
    this.activate(page.id)
    const attention = page.attention
    if (attention?.kind === "filter") page.filter.show()
    if (attention?.kind === "tag") void page.router.navigate({ to: "/tag/$tagId", params: { tagId: attention.subject! }, search: {} })
    if (attention?.kind === "notes") {
      const index = page.router.state.location.state.__TSR_index + 1
      page.browsing.set(String(index), { panel: "overview" })
      void page.router.navigate({ to: "/entity", search: { mode: "inspect", direct: true, collectionId: "direct", entityId: attention.subject, source: page.mainDestination } })
    }
  }
  host(state: DesktopState) {
    const closing = state.close.phase !== "idle"
    if (closing && !this.closing) { this.cancelClose(); this.navigationRevision++ }
    this.closing = closing
    for (const page of this.pages) {
      page.filter.host(closing)
      page.notes.host(closing)
      if (closing) page.playback.pause()
      else if (state.connection.status !== "ready") page.playback.deactivate()
    }
  }
  lost() { this.navigationRevision++; for (const page of this.pages) { page.filter.lost("The backend connection ended."); page.notes.lost() } }
  dispose() { for (const page of this.pages) page.dispose(); if (this.tagsPage && !this.pages.includes(this.tagsPage)) this.tagsPage.dispose(); this.pages = []; this.listeners.clear() }
}
