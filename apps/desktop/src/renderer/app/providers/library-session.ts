import { SettingsCoordinator } from "@/features/settings"
import { PlaybackCoordinator } from "@/features/video-playback"
import { BackendApi } from "@/shared/api"
import { EntityReader, emptySequence, type EntitySource } from "@/entities/entity"
import { ImportCoordinator } from "@/features/file-import"
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
  constructor(
    readonly bridge: DesktopBridge,
    readonly initial: DesktopState
  ) {
    if (initial.connection.status !== "ready") throw new Error("The backend is unavailable.")
    if (initial.connection.origin !== location.origin)
      throw new Error("The desktop connection is not this renderer's origin.")
    this.api = new BackendApi(initial.connection)
    this.preferences = new PreferenceCoordinator(this.api)
    this.settings = new SettingsCoordinator(this.api)
  }
}
export class LibrarySession extends DesktopSession {
  readonly playback = new PlaybackCoordinator()
  readonly reader: EntityReader
  readonly imports: ImportCoordinator
  readonly tasks: TaskObserver
  private readonly unobserve: () => void
  constructor(bridge: DesktopBridge, initial: DesktopState) {
    super(bridge, initial)
    this.reader = new EntityReader(this.api, 256, (entityId, fileId) =>
      this.playback.observe(entityId, fileId)
    )
    this.imports = new ImportCoordinator(this.api, bridge, (items) => {
      this.reader.importEffects(items)
    })
    this.imports.host(initial)
    this.tasks = new TaskObserver(this.api, () => {
      this.imports.observeTasks([...this.tasks.records.values()].map((record) => record.task))
      void this.imports.observe()
    })
    this.unobserve = bridge.observe((state) => {
      if (state.close.phase !== "idle" || state.connection.status !== "ready") this.playback.pause()
      this.imports.host(state)
      if (state.connection.status !== "ready" || state.connection.runId !== this.api.context.runId)
        this.tasks.dispose()
    })
    this.tasks.start()
    window.addEventListener("pagehide", this.dispose, { once: true })
    void this.imports.observe()
  }
  readonly demand = (ids: string[]) => {
    this.reader.demand(ids)
    this.preferences.demand(ids)
  }
  readonly dispose = () => {
    this.playback.pause()
    this.unobserve()
    this.tasks.dispose()
    this.imports.dispose()
    window.removeEventListener("pagehide", this.dispose)
  }
  readonly get = (id: string) => {
    const entity = this.reader.get(id)
    return { ...entity, problems: [...(entity.problems ?? []), ...this.preferences.problems(id)] }
  }
  source(): EntitySource {
    return { sequence: this.reader.sequence ?? emptySequence, get: this.get, demand: this.demand }
  }
}

let active: Promise<DesktopSession> | undefined
export function openLibrarySession() {
  return (active ??= (async () => {
    const bridge = window.locusDesktop
    if (!bridge)
      throw new Error(
        "No desktop connection. Open Locus through the desktop entry or the isolated desktop-ui preview."
      )
    const initial = await bridge.state()
    if (initial.connection.status === "ready" && initial.connection.availability?.status === "restricted")
      return new DesktopSession(bridge, initial)
    const session = new LibrarySession(bridge, initial)
    void session.reader.refresh()
    return session
  })())
}
