import { createFileRoute } from "@tanstack/react-router"
import { useEffect } from "react"
import { useLibrarySession } from "../providers/library-provider"

export const Route = createFileRoute("/setting")({ component: SettingsEntry })

function SettingsEntry() {
  const session = useLibrarySession()
  const navigate = Route.useNavigate()
  useEffect(() => {
    if (!session) return
    // Preserve old deep links without creating a second settings page.
    void navigate({ to: "/entity", search: { mode: "grid", collectionId: "library" }, replace: true }).then(
      () => session.settingsNavigation.setOpen(true),
    )
  }, [session, navigate])
  return null
}
