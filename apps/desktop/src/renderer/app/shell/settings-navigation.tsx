import { useEffect, useSyncExternalStore } from "react"
import { useRouter, useRouterState } from "@tanstack/react-router"
import { ArrowLeftIcon, PlugIcon, SlidersHorizontalIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { externalStatus, groupStatus, mediaPending } from "@/features/settings"
import { useLibrarySession } from "../providers/library-provider"

const noSubscribe = () => () => {}
const zero = () => 0
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

export function SettingsHistoryBinding() {
  const session = useLibrarySession()
  const router = useRouter()
  useEffect(() => {
    let previous = router.history.location
    return router.history.subscribe(({ location, action }) => {
      session?.settingsNavigation.observe(previous, location, action.type)
      if (action.type === "PUSH") {
        for (const key of session?.browsing.keys() ?? [])
          if (Number(key) >= location.state.__TSR_index) session?.browsing.delete(key)
      }
      previous = location
    })
  }, [session, router])
  return null
}

export function SettingsNavigation({ itemClassName }: { itemClassName: string }) {
  const { session, external, media } = useSettingsWorkspace()
  const router = useRouter()
  const location = useRouterState({ select: (state) => state.location })
  const navigation = session?.settingsNavigation
  const delta = navigation?.returnDelta(location)
  return (
    <div className="flex w-44 shrink-0 flex-col gap-1">
      <Button
        variant="ghost"
        className={itemClassName}
        onClick={() => {
          if (delta !== undefined) router.history.go(delta)
          else void router.navigate({ to: "/entity", search: { mode: "grid", collectionId: "library" } })
        }}
      >
        <span className="flex size-8 shrink-0 items-center justify-center">
          <ArrowLeftIcon data-icon="inline-start" />
        </span>
        {delta !== undefined ? "Return" : "Open Entity"}
      </Button>
      {(
        [
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
    </div>
  )
}
