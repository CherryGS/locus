import { useRef } from "react"
import type { LibrarySession } from "../providers/library-session"
import { errorText } from "@/shared/api"
export function useImportView(session: LibrarySession | undefined, mayNavigate: () => boolean = () => true, visit: () => number = () => 0) {
  const request = useRef(0)
  return async (id: string) => {
    if (!session) return "Library unavailable"
    const ticket = ++request.current, navigation = session.workspace.navigationRevision, originalVisit = visit()
    let present: boolean
    try { present = await session.api.entityPresent(id) }
    catch (error) { return `Unable to observe imported Entity ${id}: ${errorText(error)}` }
    if (!mayNavigate() || visit() !== originalVisit) return "Viewing was superseded by dismissal or application close."
    if (request.current !== ticket || session.workspace.navigationRevision !== navigation) return "Viewing was superseded by newer navigation."
    if (!present) return `Imported Entity ${id} is no longer available.`
    const supplied = session.imports.batches.flatMap(batch => batch.items)
      .find(item => item.current.confirmed_entity_id && item.current.entity_id === id)?.source_path
    session.workspace.direct(id, supplied?.split(/[\\/]/).pop() || undefined)
    return undefined
  }
}
