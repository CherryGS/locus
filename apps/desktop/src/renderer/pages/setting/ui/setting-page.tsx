import { useLibraryRun } from "@/app/providers/library-provider"
import { useSyncExternalStore } from "react"
import { SettingsPanel } from "@/features/settings"
import { SearchIndexSettings } from "@/features/entity-filter"
export function SettingPage() {
  const session = useLibraryRun()
  useSyncExternalStore(
    session?.settingsNavigation.subscribe ?? noSubscribe,
    session?.settingsNavigation.snapshot ?? zero,
  )
  if (!session)
    return (
      <section className="p-6">
        <h1>Settings</h1>
        <p>A live library connection is required.</p>
      </section>
    )
  return (
    <SettingsPanel
      category={session.settingsNavigation.category}
      library={session.initial.library}
      switchLibrary={session.bridge.switchLibrary}
      libraryMaintenance={<SearchIndexSettings coordinator={session.searchIndex} />}
      settings={session.settings}
      externalSettings={session.externalSettings}
      externalToken={session.externalToken}
    />
  )
}

const noSubscribe = () => () => {}
const zero = () => 0
