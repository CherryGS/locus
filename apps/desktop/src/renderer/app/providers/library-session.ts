import { BackendApi } from "@/shared/api"
import { EntityReader, emptySequence, type EntitySource } from "@/entities/entity"
import { ImportCoordinator } from "@/features/file-import"
import { PreferenceCoordinator } from "@/features/entity-view-preferences"
import type { DesktopBridge, DesktopState } from "../../../shared/desktop-bridge"

declare global {
  interface Window {
    locusDesktop?: DesktopBridge
  }
}
export class LibrarySession {
  readonly api: BackendApi
  readonly reader: EntityReader
  readonly preferences: PreferenceCoordinator
  readonly imports: ImportCoordinator
  constructor(
    readonly bridge: DesktopBridge,
    readonly initial: DesktopState
  ) {
    if (initial.connection.status !== "ready")
      throw new Error(
        initial.connection.status === "starting" ? "The backend is still starting." : initial.connection.message
      )
    if (initial.connection.origin !== location.origin)
      throw new Error("The desktop connection is not this renderer's origin.")
    this.api = new BackendApi(initial.connection)
    this.reader = new EntityReader(this.api)
    this.preferences = new PreferenceCoordinator(this.api)
    this.imports = new ImportCoordinator(this.api, bridge, (items) => {
      this.reader.importEffects(items)
    })
    this.imports.host(initial)
    bridge.observe((state) => this.imports.host(state))
    void this.imports.observe()
  }
  readonly demand = (ids: string[]) => {
    this.reader.demand(ids)
    this.preferences.demand(ids)
  }
  readonly get = (id: string) => {
    const entity = this.reader.get(id)
    return { ...entity, problems: [...(entity.problems ?? []), ...this.preferences.problems(id)] }
  }
  source(): EntitySource {
    return { sequence: this.reader.sequence ?? emptySequence, get: this.get, demand: this.demand }
  }
}

let active: Promise<LibrarySession> | undefined
export function openLibrarySession() {
  return (active ??= (async () => {
    const bridge = window.locusDesktop
    if (!bridge)
      throw new Error("No desktop connection. Open Locus through the desktop entry or the isolated desktop-ui preview.")
    const session = new LibrarySession(bridge, await bridge.state())
    void session.reader.refresh()
    return session
  })())
}
