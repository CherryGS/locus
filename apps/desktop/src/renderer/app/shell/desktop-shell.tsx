import { Outlet } from "@tanstack/react-router"
import { BrowsingHistoryBinding } from "./settings-navigation"
import { useState } from "react"
import { Separator } from "@/shared/ui/separator"
import { SourceReturnContext } from "@/shared/source-return"
import { LeftNavigation } from "./left-navigation"
import { ImportActions } from "./import-actions"
import { HistoryNavigation } from "./history-navigation"
import { SettingsDialog } from "./settings-dialog"
import { TaskWorkspace } from "./task-workspace"
import { HeaderDisplayContext } from "@/shared/ui/header-display"

export function DesktopShell() {
  const [action, setAction] = useState<(() => void) | undefined>()
  const [headerDisplay, setHeaderDisplay] = useState<HTMLDivElement | null>(null)

  return (
    <SourceReturnContext.Provider value={{ action, setAction }}>
      <HeaderDisplayContext value={headerDisplay}>
        <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
          <BrowsingHistoryBinding />
          <header className="title-bar shrink-0 bg-sidebar">
            <div className="title-bar-content flex items-center gap-3 px-4 text-xs font-medium text-muted-foreground">
              <span>Locus</span>
              <div className="flex items-center gap-0.5">
                <HistoryNavigation />
                <ImportActions />
              </div>
              <div ref={setHeaderDisplay} data-slot="header-display" className="absolute left-1/2 flex h-full max-w-[max(0px,calc(100%-32rem))] -translate-x-1/2 items-center overflow-hidden whitespace-nowrap text-xs tabular-nums select-text" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties} />
            </div>
          </header>
          <Separator />
          <TaskWorkspace>
            <LeftNavigation />
            <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
              <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
                <Outlet />
              </div>
            </main>
          </TaskWorkspace>
          <SettingsDialog />
        </div>
      </HeaderDisplayContext>
    </SourceReturnContext.Provider>
  )
}
