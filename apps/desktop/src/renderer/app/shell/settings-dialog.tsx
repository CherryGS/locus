import { useEffect, useLayoutEffect, useRef, useState } from "react"
import type { DialogRootActions } from "@base-ui/react/dialog"
import { Dialog, DialogContent, DialogTitle } from "@/shared/ui/dialog"
import { Separator } from "@/shared/ui/separator"
import { SettingPage } from "@/pages/setting"
import { SettingsNavigation, useSettingsWorkspace } from "./settings-navigation"

export function SettingsDialog() {
  const { session } = useSettingsWorkspace()
  const actions = useRef<DialogRootActions | null>(null)
  const [hostClosing, setHostClosing] = useState(false)
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
      disablePointerDismissal
      onOpenChange={(next) => {
        if (!hostClosing) session?.settingsNavigation.setOpen(next)
      }}
    >
      <DialogContent
        className="flex h-[min(44rem,calc(100dvh-2rem))] w-[calc(100%-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
        finalFocus={hostClosing ? false : () => document.getElementById("settings-trigger")}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <header className="flex h-12 shrink-0 items-center px-5 pr-12">
          <DialogTitle>Settings</DialogTitle>
        </header>
        <Separator />
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
