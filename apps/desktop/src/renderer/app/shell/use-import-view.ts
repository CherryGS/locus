import { useEffect, useRef } from "react"
import { useRouter } from "@tanstack/react-router"
import type { LibrarySession } from "../providers/library-session"
import { directDestination } from "@/pages/entity"
import { errorText } from "@/shared/api"
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
    let present: boolean
    try {
      present = await session.api.entityPresent(id)
    } catch (error) {
      return `Unable to observe imported Entity ${id}: ${errorText(error)}`
    }
    if (!mayNavigate()) return "Viewing was superseded by application close."
    if (navigation.current !== ticket) return "Viewing was superseded by newer navigation."
    if (!present) return `Imported Entity ${id} is no longer available.`
    await router.navigate({
      to: "/entity",
      search: directDestination(id, session.mainDestination),
    })
    return undefined
  }
}
