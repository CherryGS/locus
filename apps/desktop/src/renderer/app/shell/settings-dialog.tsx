import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { DialogRootActions } from "@base-ui/react/dialog"
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog"
import { Separator } from "@/shared/ui/separator"
import { Button } from "@/shared/ui/button"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { RotateCwIcon } from "lucide-react"
import { SettingPage } from "@/pages/setting"
import { SettingsNavigation, useSettingsWorkspace } from "./settings-navigation"

export function SettingsDialog() {
  const { session } = useSettingsWorkspace()
  const actions = useRef<DialogRootActions | null>(null)
  const [hostClosing, setHostClosing] = useState(false)
  const [hostError, setHostError] = useState<string>()
  // Temporarily yield to lifecycle confirmation; cancelling returns to Settings.
  const open = (session?.settingsNavigation.opened ?? false) && !hostClosing
  useEffect(
    () =>
      session?.bridge.observe((state) => {
        const closing = state.close.phase !== "idle"
        setHostClosing(closing)
      }),
    [session],
  )
  useLayoutEffect(() => {
    // Lifecycle preparation owns focus when restart/exit begins.
    if (!open && hostClosing) actions.current?.unmount()
  }, [open, hostClosing])
  return (
    <Dialog
      open={open}
      actionsRef={actions}
      onOpenChange={(next) => {
        if (!hostClosing) session?.settingsNavigation.setOpen(next)
      }}
    >
      <DialogContent
        className="flex h-[90dvh] w-[90vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none"
        finalFocus={hostClosing ? false : () => document.getElementById("locus-launcher")}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <header className="flex h-12 shrink-0 items-center justify-between gap-3 px-5 pr-12">
          <DialogTitle>Settings</DialogTitle>
          <Button variant="outline" size="sm" onClick={() => {
            setHostError(undefined)
            void session?.bridge.requestLifecycle("restart").catch(error =>
              setHostError(error instanceof Error ? error.message : "Restart unavailable"))
          }}>
            <RotateCwIcon data-icon="inline-start" />
            Restart application
          </Button>
        </header>
        <Separator />
        {hostError && <Alert variant="destructive" className="shrink-0 rounded-none">
          <AlertDescription>{hostError}</AlertDescription>
        </Alert>}
        <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
          <SettingsNavigation />
          <div className="min-h-0 min-w-0 flex-1">
            <SettingPage />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
