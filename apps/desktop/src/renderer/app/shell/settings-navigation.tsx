import { useEffect, useSyncExternalStore } from "react"
import { useRouter } from "@tanstack/react-router"
import { FolderOpenIcon, PlugIcon, SlidersHorizontalIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { externalStatus, groupStatus, mediaPending } from "@/features/settings"
import { useLibrarySession } from "../providers/library-provider"

const noSubscribe = () => () => {}
const zero = () => 0
const itemClassName = "w-full justify-start gap-2 overflow-hidden pl-0 pr-3 has-data-[icon=inline-start]:pl-0"
export function useSettingsWorkspace() {
  const session = useLibrarySession()
  useSyncExternalStore(
    session?.settingsNavigation.subscribe ?? noSubscribe,
    session?.settingsNavigation.snapshot ?? zero,
  )
  useSyncExternalStore(session?.settings.subscribe ?? noSubscribe, session?.settings.snapshot ?? zero)
  useSyncExternalStore(
    session?.externalSettings.subscribe ?? noSubscribe,
    session?.externalSettings.snapshot ?? zero,
  )
  useSyncExternalStore(
    session?.externalToken.subscribe ?? noSubscribe,
    session?.externalToken.snapshot ?? zero,
  )
  return {
    session,
    external: session ? externalStatus(session.externalSettings, session.externalToken) : "",
    media: session ? groupStatus(session.settings, mediaPending(session.settings)) : "",
  }
}

export function BrowsingHistoryBinding() {
  const session = useLibrarySession()
  const router = useRouter()
  useEffect(() => {
    return router.history.subscribe(({ location, action }) => {
      if (action.type === "PUSH") {
        for (const key of session?.browsing.keys() ?? [])
          if (Number(key) >= location.state.__TSR_index) session?.browsing.delete(key)
      }
    })
  }, [session, router])
  return null
}

export function SettingsNavigation() {
  const { session, external, media } = useSettingsWorkspace()
  const navigation = session?.settingsNavigation
  return (
    <nav
      aria-label="Settings categories"
      className="flex shrink-0 gap-1 overflow-auto border-b bg-sidebar p-2 sm:w-56 sm:flex-col sm:border-r sm:border-b-0"
    >
      {(
        [
          { id: "library", label: "Library", icon: FolderOpenIcon, status: "" },
          { id: "external", label: "External connection", icon: PlugIcon, status: external },
          { id: "media", label: "Media tools", icon: SlidersHorizontalIcon, status: media },
        ] as const
      ).map(({ id, label, icon: Icon, status }) => (
        <div key={id} className="flex flex-col gap-1">
          <Button
            variant={navigation?.category === id ? "secondary" : "ghost"}
            aria-label={label}
            aria-current={navigation?.category === id ? "page" : undefined}
            className={itemClassName}
            onClick={() => navigation?.select(id)}
          >
            <span className="flex size-8 shrink-0 items-center justify-center">
              <Icon data-icon="inline-start" />
            </span>
            <span className="truncate">{label}</span>
          </Button>
          {status && (
            <p role="status" className="px-2 pb-2 text-xs text-muted-foreground">
              {status}
            </p>
          )}
        </div>
      ))}
    </nav>
  )
}
