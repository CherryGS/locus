import { useLibrarySession } from "@/app/providers/library-provider"
import { SettingsPanel } from "@/features/settings"
export function SettingPage() {
  const session = useLibrarySession()
  if (!session)
    return (
      <section className="p-6">
        <h1>Settings</h1>
        <p>A live library connection is required.</p>
      </section>
    )
  return (
    <SettingsPanel settings={session.settings} restart={() => session.bridge.requestLifecycle("restart")} />
  )
}
