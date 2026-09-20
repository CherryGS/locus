import { Outlet } from "@tanstack/react-router"
import { Separator } from "@/shared/ui/separator"
import { LeftNavigation } from "./left-navigation"

export function DesktopShell() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header className="title-bar shrink-0 bg-sidebar">
        <div className="title-bar-content flex items-center px-4 text-xs font-medium text-muted-foreground">
          Locus
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
  )
}
