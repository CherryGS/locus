import { SettingsPanel } from "@/features/settings"
import { Button } from "@/shared/ui/button"
import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { Alert, AlertTitle, AlertDescription } from "@/shared/ui/alert"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/shared/ui/empty"
import { Spinner } from "@/shared/ui/spinner"
import { openLibrarySession, LibrarySession, type DesktopSession } from "./library-session"
import { ClosePreparation } from "./close-preparation"

const Context = createContext<LibrarySession | undefined>(undefined)
export const useLibrarySession = () => useContext(Context)
export const specimenMode =
  import.meta.env.DEV && new URLSearchParams(location.search).get("preview") === "specimens"
export function LibraryProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<DesktopSession>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (specimenMode) return
    let current = true
    void openLibrarySession().then(
      (value) => {
        if (current) setSession(value)
      },
      (reason: unknown) => {
        if (current) setError(reason instanceof Error ? reason.message : "Unable to connect to Locus.")
      }
    )
    return () => {
      current = false
    }
  }, [])
  if (specimenMode)
    return (
      <>
        <Alert>
          <AlertTitle>Specimen preview</AlertTitle>
          <AlertDescription>
            Example content and view choices are temporary. This preview does not open a library or save
            preferences.
          </AlertDescription>
        </Alert>
        {children}
      </>
    )
  if (!session)
    return (
      <Empty className="h-full">
        <EmptyHeader>
          {!error && <Spinner />}
          <EmptyTitle>{error ? "Locus is unavailable" : "Opening library…"}</EmptyTitle>
          <EmptyDescription>{error ?? "Connecting to the desktop backend."}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  if (!(session instanceof LibrarySession))
    return (
      <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
        <header className="title-bar shrink-0 bg-sidebar">
          <div className="title-bar-content px-4 text-xs text-muted-foreground">Locus · Settings repair</div>
        </header>
        <ClosePreparation session={session} />
        <div className="min-h-0 flex-1">
          <SettingsPanel
            settings={session.settings}
            externalSettings={session.externalSettings}
            externalToken={session.externalToken}
            restart={() => session.bridge.requestLifecycle("restart")}
            restricted={
              session.initial.connection.status === "ready" &&
              session.initial.connection.availability?.status === "restricted"
                ? session.initial.connection.availability.message
                : "Required services unavailable"
            }
          />
        </div>
        <div className="shrink-0 px-6 py-3">
          <Button variant="outline" onClick={() => void session.bridge.requestLifecycle("close")}>
            Exit Locus
          </Button>
        </div>
      </div>
    )
  return (
    <Context.Provider value={session}>
      <ClosePreparation session={session} />
      {children}
    </Context.Provider>
  )
}
