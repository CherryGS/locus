import type { SearchObservation } from "@locus/client"
import { EntityReadError } from "@locus/client"
import type { IdentitySequence } from "@/entities/entity"
import { ApiFailure, errorText, type BackendApi, type Wire } from "@/shared/api"
import { emptyDraft, type FilterDraft } from "./draft"
import { FilterAssistance, type AssistanceApi } from "./assistance"

type FilterApi = AssistanceApi & Pick<
  BackendApi,
  | "identities"
  | "search"
  | "searchCatalogue"
  | "searchStatus"
  | "searchEvidence"
  | "searchMaintenance"
  | "filterLanguage"
  | "filterAnalyze"
  | "filterPresets"
  | "filterPreset"
  | "filterWrite"
  | "submission"
>
type Established = {
  sequence: IdentitySequence
  criteria?: Wire<"FilterSource">
  observation?: SearchObservation
  expiresAt?: number
}
export class FilterCoordinator {
  readonly assistance: FilterAssistance
  draft = emptyDraft()
  saved?: Wire<"FilterPreset">
  established?: Established
  submitted?: FilterDraft
  open = false
  pending?: "apply" | "refresh"
  saving = false
  preparing = false
  loading = false
  guard?: { destination: string | null }
  private uncertainRecords = new Map<
    string,
    { request: string; draft: FilterDraft; change?: Wire<"FilterChange"> }
  >()
  get uncertainWrites() {
    return [...this.uncertainRecords.values()]
  }
  get uncertain() {
    return this.uncertainWrites.at(-1)
  }
  set uncertain(value: { request: string; draft: FilterDraft; change?: Wire<"FilterChange"> } | undefined) {
    if (value) {
      this.uncertainRecords.set(value.request, value)
      this.changed()
    }
  }
  error?: string
  notice?: string
  resultError?: string
  hostClosing = false
  catalogue?: Wire<"SearchCatalogueBody">
  cataloguePending = false
  catalogueError?: string
  language?: Wire<"FilterLanguage">
  helpError?: string
  helpPending = false
  presets?: Wire<"FilterPresetSummary">[]
  presetsError?: string
  analysis?: Wire<"FilterAnalysis">
  analysisPending = false
  analysisError?: string
  status?: Wire<"SearchStatusBody">
  statusPending = false
  statusError?: string
  maintenancePending?: "retry" | "rebuild"
  maintenanceError?: string
  evidence?: {
    entity: string
    pending: boolean
    value?: Wire<"Search_Evidence">
    error?: string
  }
  evidenceExpired = false
  resultRevision = 0
  private revision = 0
  private intent = 0
  private action = 0
  private visit = 0
  private analysisIntent = 0
  private presetsIntent = 0
  private evidenceIntent = 0
  private disposed = false
  private timer?: ReturnType<typeof setTimeout>
  private analysisTimer?: ReturnType<typeof setTimeout>
  private statusTimer?: ReturnType<typeof setInterval>
  private listeners = new Set<() => void>()
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
  readonly snapshot = () => this.revision
  constructor(
    private readonly api: FilterApi,
    private readonly replaced: () => void = () => {},
  ) {
    this.assistance = new FilterAssistance(api, () => this.draft.source,
      (text) => this.setDraft({ ...this.draft, source: { ...this.draft.source, text } }, true),
      () => {
        if (this.assistance.active) {
          this.analysisIntent++
          this.analysis = undefined
          this.analysisPending = false
          this.analysisError = undefined
          clearTimeout(this.analysisTimer)
        } else if (this.open) {
          clearTimeout(this.analysisTimer)
          this.analysisTimer = setTimeout(() => void this.analyze(), 350)
        }
        this.changed()
      }, () => !this.busy)
  }
  get sequence() {
    return this.established?.sequence
  }
  get filtered() {
    return !!this.established?.criteria
  }
  get busy() {
    return this.preparing || this.saving || this.loading || this.pending === "apply"
  }
  get dirty() {
    return this.saved
      ? this.draft.name !== this.saved.name ||
          JSON.stringify(this.draft.source) !== JSON.stringify(this.saved.source)
      : !!this.draft.name || !!this.draft.source.text
  }
  private changed() {
    if (!this.disposed) {
      this.revision++
      this.listeners.forEach((l) => l())
    }
  }
  edit(draft: FilterDraft) {
    if (this.busy) return
    this.assistance.exit()
    this.setDraft(draft)
  }
  private setDraft(draft: FilterDraft, helperOwned = false) {
    if (this.busy && !helperOwned) return
    this.draft = draft
    this.error = undefined
    this.analysis = undefined
    this.analysisIntent++
    clearTimeout(this.analysisTimer)
    this.analysisTimer = setTimeout(() => void this.analyze(), 350)
    this.changed()
  }
  clear() {
    this.edit({ ...this.draft, source: { ...this.draft.source, text: "" } })
  }
  show() {
    if (this.hostClosing || this.disposed) return
    this.visit++
    this.open = true
    this.changed()
    if (!this.catalogue) void this.readCatalogue()
    void this.readHelp()
    void this.readPresets()
    void this.readStatus()
    void this.analyze()
  }
  close() {
    this.assistance.exit()
    this.visit++
    this.action++
    this.open = false
    this.guard = undefined
    this.saving = false
    this.preparing = false
    this.loading = false
    if (this.pending === "apply") {
      this.intent++
      this.pending = undefined
      this.submitted = undefined
    }
    this.changed()
  }
  host(close: boolean) {
    this.hostClosing = close
    if (close) this.close()
    else this.changed()
  }
  start() {
    void this.refresh()
    void this.readStatus()
    this.statusTimer = setInterval(() => void this.readStatus(), 5000)
  }
  async readHelp() {
    if (this.helpPending) return
    this.helpPending = true
    this.helpError = undefined
    this.changed()
    const values = await Promise.allSettled([this.api.filterLanguage()])
    if (this.disposed) return
    if (values[0].status === "fulfilled") {
      this.language = values[0].value
      if (!this.draft.source.format && !this.saved) {
        this.draft = {
          ...this.draft,
          source: {
            ...this.draft.source,
            format: this.language.format,
            version: this.language.version,
          },
        }
        void this.analyze()
      }
    }
    this.helpError =
      values
        .filter((r) => r.status === "rejected")
        .map((r) => errorText((r as PromiseRejectedResult).reason))
        .join("; ") || undefined
    this.helpPending = false
    this.changed()
  }
  async readPresets() {
    const ticket = ++this.presetsIntent
    try {
      const values = await this.api.filterPresets()
      if (!this.disposed && ticket === this.presetsIntent) {
        this.presets = values
        this.presetsError = undefined
      }
    } catch (e) {
      if (ticket === this.presetsIntent) this.presetsError = errorText(e)
    }
    this.changed()
  }
  async analyze() {
    if (this.assistance.active) {
      this.analysisIntent++
      this.analysis = undefined
      this.analysisError = undefined
      this.analysisPending = false
      this.changed()
      return
    }
    const source = structuredClone(this.draft.source),
      ticket = ++this.analysisIntent
    this.analysisPending = true
    this.analysisError = undefined
    this.changed()
    try {
      const value = await this.api.filterAnalyze(source)
      if (!this.disposed && ticket === this.analysisIntent) this.analysis = value
    } catch (e) {
      if (ticket === this.analysisIntent) this.analysisError = errorText(e)
    } finally {
      if (ticket === this.analysisIntent) {
        this.analysisPending = false
        this.changed()
      }
    }
  }
  requestSwitch(destination: string | null) {
    if (this.busy) return
    this.assistance.exit()
    if (this.dirty) {
      this.guard = { destination }
      this.changed()
    } else void this.switchTo(destination)
  }
  async resolveGuard(choice: "save" | "discard" | "cancel") {
    const guard = this.guard
    this.guard = undefined
    this.changed()
    if (!guard || choice === "cancel") return
    if (choice === "save") await this.save(undefined, guard)
    else await this.switchTo(guard.destination)
  }
  private async switchTo(destination: string | null) {
    const visit = this.visit,
      action = ++this.action
    this.loading = true
    this.changed()
    try {
      const value = destination ? await this.api.filterPreset(destination) : undefined
      if (visit !== this.visit || action !== this.action || this.disposed) return
      this.saved = value
      this.draft = value
        ? { name: value.name, source: structuredClone(value.source) }
        : {
            ...emptyDraft(),
            source: {
              ...emptyDraft().source,
              format: this.language?.format ?? "",
              version: this.language?.version ?? 0,
            },
          }
      this.analysis = undefined
      this.error = undefined
      this.submitted = undefined
      void this.analyze()
    } catch (e) {
      if (visit === this.visit && action === this.action) this.error = errorText(e)
    } finally {
      if (visit === this.visit && action === this.action) {
        this.loading = false
        this.changed()
      }
    }
  }
  async save(asName?: string, switching?: { destination: string | null }) {
    if (this.busy || this.disposed || !this.open) return false
    const visit = this.visit, action = ++this.action
    if (this.assistance.active && !await this.finishHelper(visit, action)) return false
    if (visit !== this.visit || action !== this.action || this.disposed || this.busy || !this.open) return false
    const draft = structuredClone(this.draft),
      saved = this.saved
    const name = asName ?? draft.name
    if (!name.trim()) {
      this.error = "Enter a preset name before saving."
      this.changed()
      return false
    }
    const intent = ++this.intent
    const change: Wire<"FilterChange"> =
      asName !== undefined || !saved
        ? { operation: "create", name, source: draft.source }
        : {
            operation: "update",
            id: saved.id,
            revision: saved.revision,
            name,
            source: draft.source,
          }
    this.pending = undefined
    this.saving = true
    this.error = undefined
    this.notice = undefined
    this.submitted = draft
    this.changed()
    const request = crypto.randomUUID()
    let outcomeReceived = false
    try {
      const outcome = await this.api.filterWrite({
        request_id: request,
        change,
      })
      outcomeReceived = true
      if (outcome.status === "filter_failed") {
        if (outcome.uncertain) this.uncertain = { request, draft, change }
        throw new Error(`${outcome.uncertain ? "Save outcome uncertain: " : ""}${outcome.message}`)
      }
      if (outcome.status !== "filter_saved") throw new Error("Unexpected preset save outcome")
      this.notice = `Saved “${outcome.preset.name}”.`
      if (this.disposed || visit !== this.visit || action !== this.action) {
        this.changed()
        return true
      }
      this.saved = outcome.preset
      this.draft = {
        name: outcome.preset.name,
        source: structuredClone(outcome.preset.source),
      }
      void this.readPresets()
      if (visit !== this.visit || action !== this.action) return true
      if (intent === this.intent)
        await this.applySource(draft.source, intent, visit, !!switching, outcome.preset.name)
      else this.notice = `Saved “${outcome.preset.name}”, not applied: a newer result request took priority.`
      if (switching && visit === this.visit && action === this.action) {
        this.saving = false
        await this.switchTo(switching.destination)
      }
      return true
    } catch (e) {
      if (!outcomeReceived && !(e instanceof ApiFailure)) this.uncertain = { request, draft, change }
      if (visit === this.visit && action === this.action) this.error = errorText(e)
      return false
    } finally {
      if (visit === this.visit && action === this.action) {
        this.saving = false
        this.submitted = undefined
        this.changed()
      }
    }
  }
  async reconcile(request?: string) {
    const uncertain = request ? this.uncertainRecords.get(request) : this.uncertain
    if (!uncertain) return
    try {
      const result = await this.api.submission(uncertain.request)
      if (result.status !== "direct_complete") {
        this.notice = "Save completion is still unconfirmed. Check again before rereading."
        this.changed()
        return
      }
      const outcome = result.outcome
      this.notice =
        outcome.status === "filter_saved"
          ? `Confirmed saved “${outcome.preset.name}”. Load it explicitly to reconcile the draft.`
          : outcome.status === "filter_failed"
            ? outcome.message
            : "Preset operation completed. Reread the record."
      if (!(outcome.status === "filter_failed" && outcome.uncertain))
        this.uncertainRecords.delete(uncertain.request)
      await this.readPresets()
    } catch (e) {
      this.error = `Save remains uncertain: ${errorText(e)}`
    }
    this.changed()
  }
  async rename(name: string) {
    if (!this.saved || this.busy) return
    await this.organize({
      operation: "rename",
      id: this.saved.id,
      revision: this.saved.revision,
      name,
    })
  }
  async deletePreset() {
    if (!this.saved || this.busy) return
    await this.organize({
      operation: "delete",
      id: this.saved.id,
      revision: this.saved.revision,
    })
  }
  private async organize(change: Wire<"FilterChange">) {
    const visit = this.visit,
      action = ++this.action,
      original = this.saved,
      draft = structuredClone(this.draft),
      request = crypto.randomUUID()
    this.saving = true
    this.changed()
    let outcomeReceived = false
    try {
      const outcome = await this.api.filterWrite({
        request_id: request,
        change,
      })
      outcomeReceived = true
      if (outcome.status === "filter_failed") {
        if (outcome.uncertain)
          this.uncertain = {
            request,
            draft,
            change,
          }
        throw new Error(outcome.message)
      }
      if (visit === this.visit && action === this.action && original?.id === this.saved?.id) {
        if (outcome.status === "filter_deleted") {
          this.saved = undefined
          this.notice = "Preset deleted; source remains an unsaved draft."
        } else if (outcome.status === "filter_saved") {
          this.saved = outcome.preset
          if (this.draft.name === original?.name) this.draft = { ...this.draft, name: outcome.preset.name }
          this.notice = "Preset renamed."
        }
      }
      await this.readPresets()
    } catch (e) {
      if (!outcomeReceived && !(e instanceof ApiFailure))
        this.uncertain = {
          request,
          draft,
          change,
        }
      if (visit === this.visit && action === this.action) this.error = errorText(e)
    } finally {
      if (visit === this.visit && action === this.action) {
        this.saving = false
        this.changed()
      }
    }
  }
  async apply() {
    if (this.busy || this.disposed || this.hostClosing) return false
    const visit = this.visit, action = ++this.action
    if (this.assistance.active && !await this.finishHelper(visit, action)) return false
    if (visit !== this.visit || action !== this.action || this.disposed || this.busy || this.hostClosing) return false
    this.submitted = structuredClone(this.draft)
    return this.applySource(this.submitted.source, ++this.intent, visit, false, undefined)
  }
  async prepareHelperAction() {
    if (this.busy || this.disposed || !this.open) return false
    const visit = this.visit, action = ++this.action
    if (this.assistance.active && !await this.finishHelper(visit, action)) return false
    return visit === this.visit && action === this.action && !this.disposed && !this.busy && this.open
  }
  private async finishHelper(visit: number, action: number) {
    this.preparing = true
    this.changed()
    try { return await this.assistance.complete() }
    finally {
      if (visit === this.visit && action === this.action) { this.preparing = false; this.changed() }
    }
  }
  private async applySource(
    source: Wire<"FilterSource">,
    intent: number,
    visit: number,
    keepOpen: boolean,
    saved: string | undefined,
  ) {
    this.pending = "apply"
    this.error = undefined
    this.changed()
    try {
      const analysis = await this.api.filterAnalyze(source)
      if (intent !== this.intent || visit !== this.visit || this.disposed) return false
      if (JSON.stringify(this.draft.source) === JSON.stringify(source)) this.analysis = analysis
      if (!["valid", "empty"].includes(analysis.state)) {
        this.notice = saved
          ? ["invalid", "unsupported"].includes(analysis.state)
            ? `Saved “${saved}” with problems: ${analysis.diagnostics.map((d) => d.message).join("; ")}`
            : `Saved “${saved}”, not applied: ${analysis.diagnostics.map((d) => d.message).join("; ") || "Validation unavailable"}`
          : undefined
        this.error = analysis.diagnostics.map((d) => d.message).join("; ") || "Validation unavailable"
        this.pending = undefined
        this.changed()
        return false
      }
      const success = await this.replace(
        analysis.state === "empty" ? undefined : source,
        "apply",
        intent,
        keepOpen,
      )
      if (!success && saved && intent === this.intent)
        this.notice = `Saved “${saved}”, not applied: ${this.error ?? "Application failed"}`
      return success
    } catch (e) {
      if (intent === this.intent && visit === this.visit) {
        this.pending = undefined
        this.error = errorText(e)
        if (saved) this.notice = `Saved “${saved}”, not applied: ${errorText(e)}`
        this.changed()
      }
      return false
    }
  }
  refresh() {
    return this.replace(this.established?.criteria, "refresh")
  }
  private async replace(
    criteria: Wire<"FilterSource"> | undefined,
    operation: "apply" | "refresh",
    ticket?: number,
    keepOpen = false,
  ) {
    if (this.disposed) return false
    const intent = ticket ?? ++this.intent
    this.pending = operation
    if (operation === "apply") this.error = undefined
    else this.resultError = undefined
    this.changed()
    let observation: SearchObservation | undefined
    try {
      observation = criteria ? await this.api.search(criteria) : undefined
      const sequence = observation?.entities ?? (await this.api.identities())
      if (this.disposed || intent !== this.intent) {
        this.release(observation)
        return false
      }
      this.release(this.established?.observation)
      clearTimeout(this.timer)
      this.evidenceIntent++
      this.evidence = undefined
      this.evidenceExpired = false
      this.established = {
        sequence,
        criteria,
        observation,
        expiresAt: observation ? Date.now() + observation.expiresAfterSeconds * 1000 : undefined,
      }
      if (observation)
        this.timer = setTimeout(() => this.expireEvidence(), observation.expiresAfterSeconds * 1000)
      this.pending = undefined
      this.resultError = undefined
      this.submitted = undefined
      this.resultRevision++
      if (operation === "apply" && !keepOpen) {
        this.open = false
        this.saving = false
      }
      this.changed()
      this.replaced()
      return true
    } catch (e) {
      this.release(observation)
      if (!this.disposed && intent === this.intent) {
        if (operation === "apply") {
          this.error = errorText(e)
          const diagnostic =
            e instanceof EntityReadError
              ? e.apiError?.diagnostic
              : e instanceof ApiFailure
                ? e.detail.diagnostic
                : undefined
          const definitionError =
            e instanceof EntityReadError
              ? e.apiError?.code === "invalid_request"
              : e instanceof ApiFailure && e.detail.code === "invalid_request"
          if (criteria && diagnostic?.owner === "filter")
            this.analysis = {
              source: criteria,
              state: definitionError ? "invalid" : "unavailable",
              diagnostics: [
                {
                  start: diagnostic.start,
                  end: diagnostic.end,
                  message: diagnostic.message,
                },
              ],
              parsed:
                JSON.stringify(this.analysis?.source) === JSON.stringify(criteria)
                  ? (this.analysis?.parsed ?? null)
                  : null,
            }
        } else this.resultError = errorText(e)
        this.pending = undefined
        this.submitted = undefined
        this.changed()
      }
      return false
    }
  }
  async readCatalogue() {
    if (this.cataloguePending || this.disposed) return
    this.cataloguePending = true
    this.catalogueError = undefined
    this.changed()
    try {
      const value = await this.api.searchCatalogue()
      if (!this.disposed) {
        this.catalogue = value
        this.assistance.fields = value.fields
      }
    } catch (error) {
      if (!this.disposed) this.catalogueError = errorText(error)
    } finally {
      this.cataloguePending = false
      this.changed()
    }
  }
  async readStatus() {
    if (this.statusPending || this.disposed) return
    this.statusPending = true
    this.changed()
    try {
      const value = await this.api.searchStatus()
      if (!this.disposed) {
        this.status = value
        this.statusError = undefined
      }
    } catch (error) {
      if (!this.disposed) this.statusError = errorText(error)
    } finally {
      this.statusPending = false
      this.changed()
    }
  }
  async maintain(action: "retry" | "rebuild") {
    if (this.maintenancePending || this.disposed) return
    this.maintenancePending = action
    this.maintenanceError = undefined
    this.changed()
    try {
      await this.api.searchMaintenance(action)
      await this.readStatus()
    } catch (error) {
      if (!this.disposed) this.maintenanceError = errorText(error)
    } finally {
      this.maintenancePending = undefined
      this.changed()
    }
  }
  private expireEvidence() {
    this.evidenceIntent++
    this.evidenceExpired = true
    this.evidence = undefined
    this.release(this.established?.observation)
    this.changed()
  }
  async readEvidence(entity: string) {
    const established = this.established
    if (
      !established?.observation?.context ||
      this.evidenceExpired ||
      this.disposed ||
      established.sequence.indexOf(entity) < 0
    )
      return
    if (Date.now() >= established.expiresAt!) {
      this.expireEvidence()
      return
    }
    const ticket = ++this.evidenceIntent
    this.evidence = { entity, pending: true }
    this.changed()
    try {
      const values = await this.api.searchEvidence({
        context: established.observation.context,
        entities: [entity],
      })
      if (values.length !== 1 || values[0].entity !== entity)
        throw new Error("Evidence did not match the requested Entity.")
      if (!this.disposed && ticket === this.evidenceIntent)
        this.evidence = { entity, pending: false, value: values[0] }
    } catch (error) {
      if (!this.disposed && ticket === this.evidenceIntent) {
        if (error instanceof ApiFailure && [404, 410].includes(error.status)) this.expireEvidence()
        else this.evidence = { entity, pending: false, error: errorText(error) }
      }
    } finally {
      this.changed()
    }
  }
  private release(observation?: SearchObservation) {
    if (observation) void observation.release().catch(() => {})
  }
  dispose() {
    if (this.disposed) return
    this.assistance.exit()
    this.disposed = true
    this.intent++
    this.evidenceIntent++
    clearTimeout(this.timer)
    clearInterval(this.statusTimer)
    clearTimeout(this.analysisTimer)
    this.release(this.established?.observation)
    this.listeners.clear()
  }
}
