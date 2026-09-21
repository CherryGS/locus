import { useEffect, useRef } from "react"
import { useRouter } from "@tanstack/react-router"
import type { LibrarySession } from "../providers/library-session"
export function useImportView(session: LibrarySession | undefined, mayNavigate: () => boolean = () => true) {
  const router = useRouter()
  const navigation = useRef(0)
  useEffect(
    () =>
      router.history.subscribe(() => {
        navigation.current++
      }),
    [router],
  )
  return async (id: string) => {
    if (!session) return "Library unavailable"
    const ticket = ++navigation.current
    const success = await session.reader.refresh()
    if (!mayNavigate()) return "Viewing was superseded by application close."
    if (navigation.current !== ticket) return "Viewing was superseded by newer navigation."
    if (!success) return "Library refresh failed. The prior list and selection are preserved."
    if (session.reader.sequence?.indexOf(id) === -1)
      return `Imported Entity ${id} is absent from the refreshed library.`
    await router.navigate({
      to: "/entity",
      search: {
        entityId: id,
        mode: "inspect",
        collectionId: "library",
        source: { mode: "grid", collectionId: "library" },
      },
    })
    return undefined
  }
}
