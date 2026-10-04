import {
  SettingsCoordinator,
  externalAddressSettings,
  ExternalTokenCoordinator,
} from "@/features/settings"
import { DraftPreparationCoordinator } from "./draft-preparation"
import { SettingsNavigation } from "./settings-navigation"
import { WorkspaceSession } from "./workspace-session"
import { EntityNotesWrites } from "@/features/entity-notes"
import { FilterCoordinator } from "@/features/entity-filter"
import { TagCoordinator, TagBrowsing, TagDetails } from "@/features/tags"
import { BackendApi } from "@/shared/api"
import { EntityReader } from "@/entities/entity"
import { ImportCoordinator } from "@/features/file-import"
import { CivitaiCoordinator } from "@/features/civitai"
import { CardCoverCoordinator } from "@/features/entity-card-cover"
import { TaskObserver } from "@/entities/task"
import { PreferenceCoordinator } from "@/features/entity-view-preferences"
import type { DesktopBridge, DesktopState } from "../../../shared/desktop-bridge"

declare global {
  interface Window {
    locusDesktop?: DesktopBridge
  }
}
export class DesktopSession {
  readonly api: BackendApi
  readonly preferences: PreferenceCoordinator
  readonly settings: SettingsCoordinator
  readonly externalSettings: ReturnType<typeof externalAddressSettings>
  readonly externalToken: ExternalTokenCoordinator
  readonly draftPreparation: DraftPreparationCoordinator
  constructor(
    readonly bridge: DesktopBridge,
    readonly initial: DesktopState,
  ) {
    if (initial.connection.status !== "ready") throw new Error("The backend is unavailable.")
    if (initial.connection.origin !== location.origin)
      throw new Error("The desktop connection is not this renderer's origin.")
    this.api = new BackendApi(initial.connection)
    this.preferences = new PreferenceCoordinator(this.api)
    this.settings = new SettingsCoordinator(this.api)
    this.externalSettings = externalAddressSettings(this.api)
    this.externalToken = new ExternalTokenCoordinator(this.api)
    this.draftPreparation = new DraftPreparationCoordinator([this.settings, this.externalSettings])
  }
}
export class LibrarySession extends DesktopSession {
  readonly covers: CardCoverCoordinator
  private unobserveCovers: () => void
  private unobserveCivitaiCovers: () => void
  readonly settingsNavigation = new SettingsNavigation()
  readonly audio = { volume: 1, muted: false }
  readonly workspace: WorkspaceSession
  readonly reader: EntityReader
  readonly tags: TagCoordinator
  readonly tagBrowsing: TagBrowsing
  readonly tagDetails: TagDetails
  readonly notesWrites: EntityNotesWrites
  readonly searchIndex: FilterCoordinator
  readonly imports: ImportCoordinator
  readonly civitai: CivitaiCoordinator
  readonly tasks: TaskObserver
  private readonly unobserve: () => void
  private readonly unobserveImports: () => void
  constructor(bridge: DesktopBridge, initial: DesktopState) {
    super(bridge, initial)
    this.reader = new EntityReader(this.api, 256)
    this.civitai = new CivitaiCoordinator(this.api, (ids) => this.reader.knownEffects(ids))
    this.civitai.host(initial)
    this.covers = new CardCoverCoordinator(this.api, id => this.reader.get(id), id => this.civitai.blocked(id))
    this.draftPreparation.add(this.covers)
    this.unobserveCovers = this.reader.subscribe(() => this.covers.observe())
    this.unobserveCivitaiCovers = this.civitai.subscribe(() => this.covers.observe())
    this.tags = new TagCoordinator(this.api, this.api.context.runId, (ids) =>
      this.reader.tagEffects(ids),
    )
    this.tags.host(initial.close.phase !== "idle")
    this.tagBrowsing = new TagBrowsing(this.api, this.tags)
    this.tagDetails = new TagDetails(this.api, this.tags)
    this.notesWrites = new EntityNotesWrites(this.api)
    this.searchIndex = new FilterCoordinator(this.api)
    this.workspace = new WorkspaceSession(this)
    this.imports = new ImportCoordinator(this.api, bridge, (items) => {
      this.reader.importEffects(items)
      this.civitai.invalidate()
    })
    this.imports.host(initial)
    this.unobserveImports = this.imports.subscribe(() =>
      this.civitai.setImports(this.imports.batches.flatMap((b) => b.items)),
    )
    this.tasks = new TaskObserver(this.api, () => {
      this.imports.observeTasks([...this.tasks.records.values()].map((record) => record.task))
      void this.imports.observe()
      void this.civitai.observe()
    })
    this.unobserve = bridge.observe((state) => {
      this.workspace.host(state)
      this.tags.host(state.close.phase !== "idle")
      this.imports.host(state)
      this.civitai.host(state)
      this.covers.host(state.close.phase !== "idle", state.connection.status === "ready" && state.connection.runId === this.api.context.runId)
      if (state.connection.status !== "ready" || state.connection.runId !== this.api.context.runId) {
        this.workspace.lost()
        this.tags.dispose()
        this.tagBrowsing.dispose()
        this.tagDetails.lost("The backend connection ended. Document text has not been confirmed saved.")
        this.tasks.dispose()
      }
    })
    this.tasks.start()
    window.addEventListener("pagehide", this.dispose, { once: true })
    void this.imports.observe()
    void this.civitai.observe()
  }
  readonly dispose = () => {
    this.workspace.dispose()
    this.searchIndex.dispose()
    this.unobserve()
    this.tasks.dispose()
    this.tags.dispose()
    this.tagBrowsing.dispose()
    this.tagDetails.dispose()
    this.imports.dispose()
    this.unobserveImports()
    this.civitai.dispose()
    this.unobserveCovers()
    this.unobserveCivitaiCovers()
    this.covers.dispose()
    window.removeEventListener("pagehide", this.dispose)
  }
  readonly get = (id: string) => {
    const entity = this.reader.get(id)
    return { ...entity,
      components: entity.components.map(component => component.kind === "civitai"
        ? { ...component, thumbnail: this.covers.get(id).preview } : component),
      problems: [...(entity.problems ?? []), ...this.preferences.problems(id)] }
  }

}

let active: Promise<DesktopSession> | undefined
export function openLibrarySession() {
  return (active ??= (async () => {
    const bridge = window.locusDesktop
    if (!bridge)
      throw new Error(
        "No desktop connection. Open Locus through the desktop entry or the isolated desktop-ui preview.",
      )
    const initial = await bridge.state()
    if (initial.connection.status === "ready" && initial.connection.availability?.status === "restricted")
      return new DesktopSession(bridge, initial)
    const session = new LibrarySession(bridge, initial)
    return session
  })())
}
