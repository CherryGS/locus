import { useState } from "react"
import { Outlet } from "@tanstack/react-router"
import { PanelLeftCloseIcon, PanelLeftOpenIcon, PanelRightIcon } from "lucide-react"
import { motion, useReducedMotion } from "motion/react"
import { Button } from "@/shared/ui/button"
import { Empty, EmptyDescription, EmptyHeader } from "@/shared/ui/empty"
import { Separator } from "@/shared/ui/separator"
import { LeftNavigation } from "./left-navigation"

export function DesktopShell() {
  const [navigationCollapsed, setNavigationCollapsed] = useState(false)
  const [activePanel, setActivePanel] = useState<"overview" | null>(null)
  const reduceMotion = useReducedMotion()

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <header className="title-bar shrink-0 bg-sidebar">
        <div className="title-bar-content flex items-center gap-2 px-3 text-xs font-medium text-muted-foreground">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={navigationCollapsed ? "Expand navigation" : "Collapse navigation"}
            title={navigationCollapsed ? "Expand navigation" : "Collapse navigation"}
            aria-controls="primary-navigation"
            onClick={() => setNavigationCollapsed((current) => !current)}
          >
            {navigationCollapsed
              ? <PanelLeftOpenIcon data-icon="inline-start" />
              : <PanelLeftCloseIcon data-icon="inline-start" />}
          </Button>
          Locus
        </div>
      </header>
      <Separator />
      <div className="flex min-h-0 flex-1">
        <LeftNavigation collapsed={navigationCollapsed} />
        <main className="min-w-0 flex-1 overflow-auto p-6">
          <Outlet />
        </main>
        {activePanel === "overview" && (
          <>
            <Separator orientation="vertical" />
            <motion.aside
              id="overview-panel"
              aria-labelledby="overview-heading"
              className="w-64 shrink-0 overflow-auto bg-sidebar"
              initial={{ opacity: reduceMotion ? 1 : 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.12 }}
            >
              <h2 id="overview-heading" className="px-4 py-4 text-sm font-medium">Overview</h2>
              <Empty className="p-4">
                <EmptyHeader>
                  <EmptyDescription>No entity selected.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            </motion.aside>
          </>
        )}
        <Separator orientation="vertical" />
        <aside aria-label="Auxiliary panels" className="flex w-12 shrink-0 flex-col items-center gap-2 bg-sidebar py-2">
          <Button
            variant={activePanel === "overview" ? "secondary" : "ghost"}
            className="h-auto w-10 flex-col gap-2 py-3"
            aria-label="Overview"
            title="Overview"
            aria-expanded={activePanel === "overview"}
            aria-controls={activePanel === "overview" ? "overview-panel" : undefined}
            onClick={() => setActivePanel((current) => current === "overview" ? null : "overview")}
          >
            <PanelRightIcon data-icon="inline-start" />
            <span className="[writing-mode:vertical-rl]">Overview</span>
          </Button>
        </aside>
      </div>
      <Separator />
      <footer aria-label="Application footer" className="h-6 shrink-0 bg-sidebar" />
    </div>
  )
}
