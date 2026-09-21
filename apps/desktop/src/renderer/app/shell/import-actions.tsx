import { useEffect, useRef } from "react"
import { useRouter } from "@tanstack/react-router"
import { ImportPanel } from "@/features/file-import"
import { useLibrarySession } from "../providers/library-provider"

export function ImportActions() {
  const session = useLibrarySession()
  const router = useRouter()
  const navigation = useRef(0)
  useEffect(
    () =>
      router.history.subscribe(() => {
        navigation.current++
      }),
    [router],
  )
  if (!session) return null
  return (
    <ImportPanel
      coordinator={session.imports}
      view={async (id) => {
        const ticket = ++navigation.current
        const success = await session.reader.refresh()
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
      }}
    />
  )
}
