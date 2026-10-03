import { LibrarySettingsPanel, type LibrarySettingsProps } from "./library-settings-panel"
import { useEffect, useState, type ReactNode } from "react"
import { RotateCwIcon } from "lucide-react"
import { Alert, AlertTitle, AlertDescription } from "@/shared/ui/alert"
import { Button } from "@/shared/ui/button"
import type { SettingsCoordinator } from "../model/settings-coordinator"
import type { externalAddressSettings, ExternalTokenCoordinator } from "../model/external-access"
import { ExternalAccessPanel } from "./external-access-panel"
import { MediaSettingsPanel } from "./media-settings-panel"

export function SettingsPanel({
  settings,
  restart,
  restricted,
  externalSettings,
  externalToken,
  category = "external",
  library,
  switchLibrary,
  libraryMaintenance,
}: {
  settings: SettingsCoordinator
  restart: () => Promise<void>
  restricted?: string
  externalSettings: ReturnType<typeof externalAddressSettings>
  externalToken: ExternalTokenCoordinator
  category?: "library" | "external" | "media"
  libraryMaintenance?: ReactNode
} & LibrarySettingsProps) {
  const [hostError, setHostError] = useState<string>()
  useEffect(() => {
    // Read both groups on entry, including offscreen application/recovery state.
    // Coordinators preserve drafts and never replay an unresolved operation here.
    void settings.load()
    void externalSettings.load()
    if (!restricted) void externalToken.read()
  }, [settings, externalSettings, externalToken, restricted])
  return (
    <section
      className="@container/settings-workspace h-full overflow-auto bg-background [scrollbar-color:var(--border)_transparent] [scrollbar-gutter:stable] [scrollbar-width:thin]"
      aria-label="Settings workspace"
    >
      <div className="mx-auto flex max-w-[800px] flex-col gap-5 px-4 py-6 @min-[36rem]/settings-workspace:px-8">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold tracking-tight">
              {restricted
                ? "Settings repair"
                : category === "external"
                  ? "External connection"
                  : category === "library"
                    ? "Library"
                    : "Media tools"}
            </h1>
            {restricted && (
              <p className="text-xs text-muted-foreground">
                Repair configuration to start this library.
              </p>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setHostError(undefined)
              void restart().catch((error) =>
                setHostError(error instanceof Error ? error.message : "Restart unavailable"),
              )
            }}
          >
            <RotateCwIcon data-icon="inline-start" />
            {restricted ? "Retry application" : "Restart application"}
          </Button>
        </header>
        {restricted && (
          <Alert variant="destructive">
            <AlertTitle>Library needs attention</AlertTitle>
            <AlertDescription>
              {restricted} Saving alone does not start library services.
            </AlertDescription>
          </Alert>
        )}
        {hostError && (
          <Alert variant="destructive">
            <AlertDescription>{hostError}</AlertDescription>
          </Alert>
        )}
        {(restricted || category === "external") && (
          <ExternalAccessPanel
            settings={externalSettings}
            token={externalToken}
            restricted={restricted}
          />
        )}
        {(category === "library" || (restricted && switchLibrary)) && (
          <LibrarySettingsPanel library={library} switchLibrary={switchLibrary} />
        )}
        {!restricted && category === "library" && libraryMaintenance}
        {(restricted || category === "media") && <MediaSettingsPanel settings={settings} />}
      </div>
    </section>
  )
}
