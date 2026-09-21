import { Outlet } from "@tanstack/react-router"
import { useState } from "react"
import { Separator } from "@/shared/ui/separator"
import { TitlebarActionsTarget } from "@/shared/ui/titlebar-actions"
import { LeftNavigation } from "./left-navigation"
import { HistoryNavigation } from "./history-navigation"

export function DesktopShell() {
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(null)

  return (
    <TitlebarActionsTarget.Provider value={actionsTarget}>
      <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
        <header className="title-bar shrink-0 bg-sidebar">
          <div className="title-bar-content flex items-center gap-3 px-4 text-xs font-medium text-muted-foreground">
            <span>Locus</span>
            <div className="flex items-center gap-0.5">
              <HistoryNavigation />
              <div ref={setActionsTarget} className="contents" />
            </div>
          </div>
        </header>
        <Separator />
        <div className="flex min-h-0 flex-1">
          <LeftNavigation />
          <main className="min-h-0 min-w-0 flex-1 overflow-hidden">
            <Outlet />
          </main>
        </div>
        <Separator />
        <footer aria-label="Application footer" className="h-6 shrink-0 bg-sidebar" />
      </div>
    </TitlebarActionsTarget.Provider>
  )
}
