import {
  SettingsCoordinator,
  externalAddressSettings,
  ExternalTokenCoordinator,
  SettingsPreparationCoordinator,
} from "@/features/settings"
import { SettingsNavigation } from "./settings-navigation"
import { PlaybackCoordinator } from "@/features/video-playback"
import { TagCoordinator, TagBrowsing } from "@/features/tags"
import { FilterCoordinator } from "@/features/entity-filter"
import { BackendApi } from "@/shared/api"
import { EntityReader, emptySequence, type EntitySource } from "@/entities/entity"
import { ImportCoordinator } from "@/features/file-import"
import { CivitaiCoordinator } from "@/features/civitai"
import type { RelatedCollection, CivitaiSelection } from "@/pages/entity"
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
  readonly settingsPreparation: SettingsPreparationCoordinator
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
    this.settingsPreparation = new SettingsPreparationCoordinator([this.settings, this.externalSettings])
  }
}
export class LibrarySession extends DesktopSession {
  readonly settingsNavigation = new SettingsNavigation()
  readonly browsing = new Map<string, import("@/pages/entity").EntityBrowsingState>()
  readonly relatedCollections = new Map<string, RelatedCollection>()
  readonly civitaiExcursions = new Map<string, CivitaiSelection>()
  readonly playback = new PlaybackCoordinator()
  readonly reader: EntityReader
  readonly tags: TagCoordinator
  readonly tagBrowsing: TagBrowsing
  tagDestination?: import("@/pages/entity").EntityDestination
  tagBrowsingState: import("@/pages/entity").EntityBrowsingState = {}
  readonly filter: FilterCoordinator
  mainDestination: import("@/pages/entity").EntityDestination = { mode: "grid", collectionId: "library" }
  readonly imports: ImportCoordinator
  readonly civitai: CivitaiCoordinator
  readonly tasks: TaskObserver
  private readonly unobserve: () => void
  private readonly unobserveImports: () => void
  constructor(bridge: DesktopBridge, initial: DesktopState) {
    super(bridge, initial)
    this.reader = new EntityReader(this.api, 256, (entityId, fileId) =>
      this.playback.observe(entityId, fileId),
    )
    this.tags = new TagCoordinator(this.api, this.api.context.runId, (ids) =>
      this.reader.tagEffects(ids),
    )
    this.tags.host(initial.close.phase !== "idle")
    this.tagBrowsing = new TagBrowsing(this.api, this.tags, () => this.reader.resultReplaced())
    this.filter = new FilterCoordinator(this.api, () => this.reader.resultReplaced())
    this.civitai = new CivitaiCoordinator(this.api, (ids) => this.reader.knownEffects(ids))
    this.civitai.host(initial)
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
      this.filter.host(state.close.phase !== "idle")
      this.tags.host(state.close.phase !== "idle")
      if (state.close.phase !== "idle" || state.connection.status !== "ready") this.playback.pause()
      this.imports.host(state)
      this.civitai.host(state)
      if (state.connection.status !== "ready" || state.connection.runId !== this.api.context.runId) {
        this.filter.dispose()
        this.tags.dispose()
        this.tagBrowsing.dispose()
        this.tasks.dispose()
      }
    })
    this.tasks.start()
    window.addEventListener("pagehide", this.dispose, { once: true })
    void this.imports.observe()
    void this.civitai.observe()
  }
  readonly demand = (ids: string[]) => {
    this.reader.demand(ids)
    this.preferences.demand(ids)
  }
  readonly dispose = () => {
    this.playback.pause()
    this.unobserve()
    this.tasks.dispose()
    this.filter.dispose()
    this.tags.dispose()
    this.tagBrowsing.dispose()
    this.imports.dispose()
    this.unobserveImports()
    this.civitai.dispose()
    window.removeEventListener("pagehide", this.dispose)
  }
  readonly get = (id: string) => {
    const entity = this.reader.get(id)
    return { ...entity, problems: [...(entity.problems ?? []), ...this.preferences.problems(id)] }
  }
  source(): EntitySource {
    return { sequence: this.filter.sequence ?? emptySequence, get: this.get, demand: this.demand }
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
    session.filter.start()
    return session
  })())
}
