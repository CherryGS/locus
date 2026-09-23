import { useEffect, useRef, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert"
import { Button } from "@/shared/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/shared/ui/dialog"
import { Spinner } from "@/shared/ui/spinner"
import type { DesktopSession } from "./library-session"

export function ClosePreparation({ session }: { session: DesktopSession }) {
  const [state, setState] = useState(session.initial)
  const [failure, setFailure] = useState<string>()
  const current = useRef(state)
  const generation = useRef(0)
  useEffect(() => {
    let observations = 0
    const receive = (next: typeof state) => {
      current.current = next
      setState(next)
      if (next.connection.status === "lost" || next.connection.status === "failed") {
        session.preferences.lost(next.connection.message)
        session.settingsPreparation.lost(next.connection.message)
        session.externalToken.lost(next.connection.message)
      }
      if (next.close.phase === "idle") {
        generation.current++
        session.preferences.returnToApplication()
        session.settingsPreparation.returnToApplication()
      }
    }
    const stop = session.bridge.observe((next) => {
      observations++
      receive(next)
    })
    void session.bridge.state().then((next) => {
      if (observations === 0) receive(next)
    })
    void session.bridge.ready()
    return stop
  }, [session])
  useEffect(() => {
    const close = state.close
    if (close.phase !== "preparing" && close.phase !== "unconfirmed" && close.phase !== "sealing") return
    const attemptId = close.attemptId
    let disposed = false
    async function prepare() {
      const ticket = ++generation.current
      const [result, settings] = await Promise.all([
        session.preferences.prepare(),
        session.settingsPreparation.prepare(),
      ])
      const actual = current.current.close
      if (
        disposed ||
        ticket !== generation.current ||
        actual.phase === "idle" ||
        actual.phase === "draining" ||
        actual.attemptId !== attemptId
      )
        return
      await session.bridge
        .prepared({ attemptId, ...result, settings })
        .catch(() => setFailure("Close preparation could not reach the native host."))
    }
    if (close.phase === "sealing") {
      const restart = close.intent === "restart"
      const settingsRevision = close.settings?.revision
      if (
        settingsRevision !== undefined &&
        session.settingsPreparation.canSeal(settingsRevision, close.continueExit, restart) &&
        session.preferences.seal(close.revision, !restart && close.continueExit) &&
        session.settingsPreparation.seal(settingsRevision, close.continueExit, restart)
      ) {
        void session.bridge
          .commitClose({ attemptId: close.attemptId, revision: close.revision, settingsRevision })
          .catch(async () => {
            setFailure("The close handoff could not be confirmed. Waiting for the host's actual close state.")
            const before = current.current
            const observed = await session.bridge.state().catch(() => undefined)
            if (observed && current.current === before) {
              current.current = observed
              setState(observed)
              if (observed.close.phase === "idle") {
                session.preferences.returnToApplication()
                session.settingsPreparation.returnToApplication()
              }
            }
          })
      } else void prepare()
      return () => {
        disposed = true
      }
    }
    void prepare()
    // A newer accepted intent/result invalidates earlier reports. Preparing
    // observes final choices even when their Entity is no longer mounted.
    const changed = () => {
      if (current.current.close.phase !== "sealing") void prepare()
    }
    const stop = session.preferences.subscribe(changed)
    const stopSettings = session.settingsPreparation.subscribe(changed)
    return () => {
      disposed = true
      stop()
      stopSettings()
    }
  }, [session, state.close])
  const close = state.close
  const returning = () => {
    if (close.phase === "idle" || close.phase === "draining") return
    generation.current++
    void session.bridge
      .closeAction({ attemptId: close.attemptId, action: "return" })
      .catch(() => setFailure("The host has not confirmed returning to Locus."))
  }
  return (
    <>
      {(state.connection.status === "lost" || state.connection.status === "failed") && (
        <Alert variant="destructive">
          <AlertTitle>Backend unavailable</AlertTitle>
          <AlertDescription>{state.connection.message}</AlertDescription>
        </Alert>
      )}
      <Dialog
        open={close.phase !== "idle"}
        onOpenChange={(open) => {
          if (!open) returning()
        }}
      >
        <DialogContent
          showCloseButton={false}
          onKeyDown={(event) => {
            event.stopPropagation()
            if (event.key === "Escape") {
              event.preventDefault()
              returning()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {close.phase === "draining"
                ? "Finishing accepted work"
                : close.phase === "unconfirmed"
                  ? "Some choices are not confirmed saved"
                  : close.phase !== "idle" && close.intent === "restart"
                    ? "Preparing to restart"
                    : "Preparing to close"}
            </DialogTitle>
            <DialogDescription>
              {close.phase === "draining"
                ? close.intent === "restart"
                  ? "Locus will restart into a fresh library session after all accepted work finishes."
                  : "Locus will close when the backend has finished all accepted operations."
                : "Confirming current view choices and Settings writes, including edits on pages you have left."}
            </DialogDescription>
          </DialogHeader>
          {failure && (
            <Alert variant="destructive">
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          )}
          {close.phase === "unconfirmed" && (close.settings?.draft || close.settings?.blocked) && (
            <Alert>
              <AlertTitle>Settings</AlertTitle>
              <AlertDescription>
                {close.settings.blocked ??
                  "There are unsubmitted edits. Restart can discard this exact draft after your confirmation."}
              </AlertDescription>
            </Alert>
          )}
          {close.phase === "unconfirmed" ? (
            <ul className="flex max-h-64 flex-col gap-3 overflow-auto text-sm">
              {close.items.map((item) => (
                <li key={item.entityId}>
                  <p className="font-medium break-all">
                    Entity {item.entityId} · {item.viewId}
                  </p>
                  <p className="text-muted-foreground">{item.reason}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              {close.phase === "draining" && close.active
                ? `${close.active} accepted operations at drain start`
                : "Waiting for actual completion…"}
            </p>
          )}
          {close.phase !== "draining" && close.phase !== "idle" && (
            <DialogFooter>
              <Button variant="outline" onClick={returning}>
                Return to Locus
              </Button>
              {close.phase === "unconfirmed" &&
                (close.intent !== "restart" || (!close.items.length && !close.settings?.blocked)) && (
                  <Button
                    onClick={() =>
                      void session.bridge.closeAction({
                        attemptId: close.attemptId,
                        action: "continue",
                        revision: close.revision,
                        settingsRevision: close.settings?.revision,
                      })
                    }
                  >
                    {close.intent === "restart" ? "Discard draft and restart" : "Continue closing"}
                  </Button>
                )}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
