import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import { Alert, AlertTitle, AlertDescription } from "@/shared/ui/alert"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/shared/ui/empty"
import { Spinner } from "@/shared/ui/spinner"
import { openLibrarySession, type LibrarySession } from "./library-session"
import { ClosePreparation } from "./close-preparation"

const Context = createContext<LibrarySession | undefined>(undefined)
export const useLibrarySession = () => useContext(Context)
export const specimenMode = import.meta.env.DEV && new URLSearchParams(location.search).get("preview") === "specimens"
export function LibraryProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<LibrarySession>()
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
            Example content and view choices are temporary. This preview does not open a library or save preferences.
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
  return (
    <Context.Provider value={session}>
      <ClosePreparation session={session} />
      {children}
    </Context.Provider>
  )
}
