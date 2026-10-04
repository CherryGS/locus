import type { EntityItem } from "@/entities/entity"
import { ApiFailure, errorText, type BackendApi, type Wire } from "@/shared/api"
import type { SettingsReadiness } from "../../../../shared/desktop-bridge"
import { previewFingerprint } from "@/shared/lib/preview-fingerprint"

export type CardCover = Wire<"CardCoverSelection">
type Entry = {
  observed?: Wire<"EntityCardCoverPreference">
  read: boolean
  pending: boolean
  problem?: string
  unavailable?: string
  attempt?: Wire<"UpdateCardCoverPreference">
  preview?: string
  fingerprint?: string
  key?: string
  presentationKey?: string
  generation: number
  observationVersion: number
  controller?: AbortController
  work?: Promise<void>
  intent?: boolean
  target?: string
  targetStamp?: string
  targetBasis?: string
}

// Presentation intent is independent of view choice and provider relationships.
// Only an attributed, currently applicable managed Image supplies grid bytes.
export class CardCoverCoordinator {
  private entries = new Map<string, Entry>()
  private needed = new Set<string>()
  private consumers = new Map<object, string[]>()
  private listeners = new Set<() => void>()
  private revision = 0
  private live = true
  private closing = false
  readonly subscribe = (listener: () => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  readonly snapshot = () => this.revision
  constructor(private api: BackendApi, private entity: (id: string) => EntityItem, private refreshingOrigin: (id: string) => boolean = () => false) {}
  get(id: string) {
    let entry = this.entries.get(id)
    if (!entry) { entry = { read: false, pending: false, generation: 0, observationVersion: 0 }; this.entries.set(id, entry) }
    return entry
  }
  private changed() { this.revision++; this.listeners.forEach(listener => listener()) }
  host(closing: boolean, available: boolean) { this.closing = closing; if (!available) this.dispose() }
  acquireDemand() {
    const consumer = {}
    let released = false
    return {
      update: (ids: string[]) => { if (!released) this.demand(ids, consumer) },
      release: () => { if (released) return; released = true; this.consumers.delete(consumer); this.demand([], consumer); this.consumers.delete(consumer) },
    }
  }
  demand(ids: string[], consumer: object = this) {
    this.consumers.set(consumer, ids)
    ids = [...new Set([...this.consumers.values()].flat())]
    this.needed = new Set(ids)
    const unread = ids.filter(id => !this.get(id).read)
    for (const id of unread) this.get(id).read = true
    if (unread.length) void this.read(unread)
    this.observe()
    for (const [id, entry] of this.entries) {
      if (this.entries.size <= 256) break
      if (!this.needed.has(id) && !entry.pending && !entry.attempt && !entry.problem) {
        entry.controller?.abort()
        if (entry.preview) URL.revokeObjectURL(entry.preview)
        this.entries.delete(id)
      }
    }
  }
  async read(ids: string[]) {
    const tickets = ids.map(id => ({ entry: this.get(id), version: this.get(id).observationVersion }))
    try {
      const values = await this.api.cardCoverPreferences(ids)
      if (!this.live) return
      if (values.length !== ids.length || values.some((value, index) => value.entity_id !== ids[index])) throw new Error("Cover observations named different Entities.")
      for (const [index, value] of values.entries()) {
        const { entry, version } = tickets[index]
        if (this.entries.get(value.entity_id) !== entry || entry.observationVersion !== version || entry.pending || entry.attempt) continue
        entry.observed = value; entry.observationVersion++; entry.problem = undefined; entry.key = undefined
      }
    } catch (error) {
      if (this.live) for (const [index, id] of ids.entries()) {
        const { entry, version } = tickets[index]
        if (this.entries.get(id) === entry && entry.observationVersion === version && !entry.pending) entry.problem = errorText(error)
      }
    }
    this.observe(); this.changed()
  }
  observe() {
    if (!this.live) return
    for (const id of this.needed) {
      const entry = this.get(id), entity = this.entity(id)
      const origin = entity.components.find(component => component.kind === "civitai")
      if (entity.loading || entity.refreshing || origin?.readStatus === "loading") {
        entry.key = undefined
        continue
      }
      if (!entry.observed) continue
      const targetStamp = entry.target && this.targetStamp(entry.target)
      if (targetStamp !== undefined && entry.targetStamp !== targetStamp) {
        const basis = this.targetStamp(entry.target!, false)
        if (entry.targetBasis !== basis) this.clearPreview(entry)
        entry.targetBasis = basis
        entry.key = undefined; entry.targetStamp = targetStamp
      }
      const cover = entry.observed.status === "saved" ? entry.observed.cover : null
      const presentationKey = JSON.stringify([origin?.id, origin?.record?.model?.id, origin?.record?.matched_version, cover])
      if (entry.presentationKey !== presentationKey) {
        this.clearPreview(entry)
        entry.presentationKey = presentationKey
      }
      if (!origin?.record || origin.view?.input !== "current" || origin.previous) {
        entry.controller?.abort()
        entry.generation++
        entry.key = undefined
        this.clearPreview(entry)
        entry.unavailable = cover ? "The selected cover's Civitai origin is unavailable." : undefined
        continue
      }
      if (this.refreshingOrigin(id)) {
        entry.controller?.abort()
        entry.key = undefined
        entry.generation++
        continue
      }
      const key = JSON.stringify([origin?.id, origin?.record?.observation, origin?.view?.input, origin?.readStatus, origin?.previous, cover])
      if (key === entry.key) continue
      entry.key = key
      entry.controller?.abort()
      entry.controller = new AbortController()
      const generation = ++entry.generation
      void this.resolve(id, entry, origin.id, origin.record.matched_version, cover, generation, entry.controller.signal)
    }
  }
  private clearPreview(entry: Entry) { if (entry.preview) URL.revokeObjectURL(entry.preview); entry.preview = undefined; entry.fingerprint = undefined }
  private targetStamp(id: string, revision = true) {
    const entity = this.entity(id)
    if (entity.loading || entity.refreshing || entity.membershipsStatus === "unread") return undefined
    return JSON.stringify([entity.membershipsStatus, entity.components.filter(component => component.kind === "file" || component.kind === "image").map(component => [component.kind, component.id, component.kind === "image" ? component.inputFileId : undefined, revision && component.kind === "image" ? component.record?.revision : undefined])])
  }
  private async resolve(id: string, entry: Entry, origin: string, matched: string, cover: CardCover | null, generation: number, signal: AbortSignal) {
    const current = () => this.live && this.entries.get(id) === entry && entry.generation === generation && !signal.aborted
    // The same cover remains visible during revalidation. observe() clears it
    // immediately when its source, selection or target membership changes.
    entry.unavailable = undefined
    try {
      const unit = await this.api.civitaiVersion(origin, cover?.version_id ?? matched, cover?.source_component_id)
      const example = unit.examples.find(example => example.applicable && example.binding.complete &&
        (!cover || example.source.component_id === cover.source_component_id && example.binding.entity_id === cover.target_entity_id && example.binding.file_id === cover.target_file_id) &&
        example.binding.media.some(media => media.kind === "image" && (!cover || media.component_id === cover.image_component_id)))
      if (!example) { if (current()) this.clearPreview(entry); if (cover) throw new Error("The selected cover is no longer an applicable saved example."); return }
      const image = example.binding.media.find(media => media.kind === "image" && (!cover || media.component_id === cover.image_component_id))!
      const verify = async () => {
        const [target] = await this.api.memberships([example.binding.entity_id])
        if (target?.entity_id !== example.binding.entity_id || target.status !== "present" ||
          !target.memberships.some(member => member.kind_id === "9fd73d3d-d35d-41bc-8b73-402e12f5c017" && member.component_id === example.binding.file_id) ||
          !target.memberships.some(member => member.kind_id === "aadf84d2-0dc0-4a81-8cdb-901162c78321" && member.component_id === image.component_id)) throw new Error("Cover Image or File membership changed.")
      }
      await verify()
      const preview = await this.api.savedPreview("image", image.component_id)
      if (!preview || preview.kind !== "image" || preview.file_id !== example.binding.file_id) throw new Error("No existing preview matches this cover's File.")
      const bytes = await this.api.previewBytes(preview.locator, signal)
      const fingerprint = await previewFingerprint(bytes)
      if (typeof createImageBitmap === "function") { const bitmap = await createImageBitmap(bytes); bitmap.close() }
      await verify()
      const latest = await this.api.civitaiVersion(origin, unit.version.id, unit.source.component_id)
      if (!latest.examples.some(item => item.source.component_id === example.source.component_id && item.applicable && item.binding.complete && item.binding.entity_id === example.binding.entity_id && item.binding.file_id === example.binding.file_id && item.binding.media.some(media => media.kind === "image" && media.component_id === image.component_id))) throw new Error("Cover relationship changed while loading.")
      const [originEntity] = await this.api.memberships([id])
      if (originEntity?.entity_id !== id || originEntity.status !== "present" || !originEntity.memberships.some(member => member.component_id === origin)) throw new Error("Cover origin membership changed.")
      const originView = await this.api.civitai(origin)
      if (originView.input !== "current" || originView.host !== id || originView.record.component_id !== origin || originView.record.model.id !== unit.model) throw new Error("Cover origin input or model changed while loading.")
      if (!current()) return
      entry.target = example.binding.entity_id; entry.targetStamp = this.targetStamp(entry.target)
      entry.targetBasis = this.targetStamp(entry.target, false)
      if (!entry.preview || entry.fingerprint !== fingerprint) {
        this.clearPreview(entry)
        entry.preview = URL.createObjectURL(bytes)
        entry.fingerprint = fingerprint
      }
    } catch (error) {
      if (current()) { this.clearPreview(entry); entry.unavailable = errorText(error) }
    } finally { if (current()) this.changed() }
  }
  async choose(id: string, cover: CardCover | null) {
    const entry = this.get(id)
    if (!this.live || this.closing || entry.pending || entry.attempt) return
    entry.pending = true; entry.intent = true; entry.problem = undefined; this.changed()
    entry.work = (async () => {
      try {
        if (!entry.observed) { entry.observed = await this.api.cardCoverPreference(id); entry.observationVersion++ }
        if (!this.live || this.closing) return
        if (entry.observed.entity_id !== id || entry.observed.status === "missing") throw new Error("This Entity is unavailable.")
        entry.attempt = { request_id: crypto.randomUUID(), expected_revision: entry.observed.status === "saved" ? entry.observed.revision : null, cover }
        this.complete(id, entry, await this.api.changeCardCoverPreference(id, entry.attempt))
      } catch (error) {
        if (!this.live) return
        entry.problem = `${entry.attempt ? "Cover save is unconfirmed" : "Cover could not be saved"}: ${errorText(error)}`
        if (error instanceof ApiFailure && error.detail.code !== "operation_failed") entry.attempt = undefined
      } finally { entry.pending = false; entry.work = undefined; this.changed() }
    })()
    await entry.work
  }
  private complete(id: string, entry: Entry, outcome: Wire<"MutationOutcome">) {
    if (!this.live) return
    entry.observationVersion++
    if (outcome.status === "card_cover_preference_saved" && outcome.preference.entity_id === id) {
      entry.observed = { status: "saved", ...outcome.preference }; entry.attempt = undefined; entry.problem = undefined; entry.key = undefined
      entry.intent = false
      this.observe()
    } else if (outcome.status === "card_cover_preference_conflict") {
      entry.observed = outcome.current; entry.attempt = undefined
      entry.problem = "The saved cover changed elsewhere. Choose again using its current revision."
      entry.key = undefined; this.observe()
    } else if (outcome.status === "card_cover_preference_missing") {
      entry.observed = { status: "missing", entity_id: id }; entry.attempt = undefined; entry.problem = "This Entity is unavailable."
      this.clearPreview(entry)
    } else if (outcome.status === "failed") {
      entry.attempt = undefined; entry.observed = undefined
      entry.problem = "Cover save failed. Read its current value before choosing again."
    } else entry.problem = "Cover save could not be confirmed. Check the original request before choosing again."
  }
  async retry(id: string) {
    const entry = this.get(id)
    if (!this.live || this.closing || entry.pending) return
    if (!entry.attempt) { await this.read([id]); return }
    const body = entry.attempt
    entry.pending = true; this.changed()
    try {
      const result = await this.api.submission(body.request_id)
      if (result.status === "direct_complete") this.complete(id, entry, result.outcome)
      else if (result.status === "rejected") { entry.attempt = undefined; entry.problem = result.error.message }
    } catch (error) {
      if (error instanceof ApiFailure && error.detail.code === "unknown_request") {
        try { this.complete(id, entry, await this.api.changeCardCoverPreference(id, body)) }
        catch (delivery) { entry.problem = errorText(delivery) }
      } else entry.problem = errorText(error)
    } finally { entry.pending = false; this.changed() }
  }
  dispose() {
    this.live = false
    for (const entry of this.entries.values()) { entry.controller?.abort(); this.clearPreview(entry) }
  }
  async prepare(): Promise<SettingsReadiness> {
    await Promise.allSettled([...this.entries.values()].flatMap(entry => entry.work ? [entry.work] : []))
    for (const [id, entry] of this.entries) if (entry.attempt && !entry.pending) await this.retry(id)
    return this.preparation()
  }
  preparation(): SettingsReadiness {
    const entries = [...this.entries.values()]
    return { revision: this.revision, draft: entries.some(entry => entry.intent && !entry.pending && !entry.attempt),
      blocked: entries.some(entry => entry.pending || entry.attempt) ? "A card cover save is still unconfirmed." : undefined }
  }
  canSeal(revision: number, discard: boolean, restart: boolean) {
    const state = this.preparation()
    return revision === state.revision && (!restart || !state.blocked && (!state.draft || discard))
  }
  seal(revision: number, discard: boolean, restart: boolean) {
    if (!this.canSeal(revision, discard, restart)) return false
    this.closing = true; return true
  }
  returnToApplication() { this.closing = false; this.changed() }
  lost(message: string) { this.live = false; for (const entry of this.entries.values()) if (entry.intent) entry.problem = message; this.changed() }
}
