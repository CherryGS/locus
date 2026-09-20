import { useEffect, useRef, useState } from "react"
import { Outlet } from "@tanstack/react-router"
import { motion, useReducedMotion } from "motion/react"
import { Button } from "@/shared/ui/button"
import { useEntitySelection } from "@/features/entity-selection"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/shared/ui/resizable"
import { Separator } from "@/shared/ui/separator"
import { LeftNavigation } from "./left-navigation"
import { entityPanels, type EntityPanelId } from "./entity-panels"

export function DesktopShell() {
  const { selectedEntity } = useEntitySelection()
  const panels = entityPanels(selectedEntity)
  const [activePanelId, setActivePanelId] = useState<EntityPanelId | null>(null)
  const missingPanel = activePanelId !== null && !panels.some((panel) => panel.id === activePanelId)
  const activePanel = activePanelId === null ? null : panels.find((panel) => panel.id === activePanelId) ?? panels[0]
  const [panelDefaultWidth, setPanelDefaultWidth] = useState(256)
  // Keep the mounted split pane's default stable during a drag. Remember its
  // live width for the next open without rerendering the shell on pointer moves.
  const lastPanelWidth = useRef(256)
  const reduceMotion = useReducedMotion()

  useEffect(() => { if (missingPanel) setActivePanelId("overview") }, [missingPanel])

  function togglePanel(id: EntityPanelId) {
    if (activePanel === null) setPanelDefaultWidth(lastPanelWidth.current)
    setActivePanelId(activePanel?.id === id ? null : id)
  }

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
        <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
          <ResizablePanel id="main-content" minSize="16rem">
            <main className="h-full min-w-0 overflow-auto p-6">
              <Outlet />
            </main>
          </ResizablePanel>
          {activePanel && (
            <>
              <ResizableHandle aria-label="Resize auxiliary panel" />
              <ResizablePanel
                id="auxiliary-content"
                defaultSize={panelDefaultWidth}
                minSize="12rem"
                groupResizeBehavior="preserve-pixel-size"
                onResize={({ inPixels }) => { lastPanelWidth.current = inPixels }}
              >
                <motion.aside
                  id="auxiliary-panel"
                  aria-labelledby="auxiliary-heading"
                  className="h-full overflow-auto bg-sidebar"
                  initial={{ opacity: reduceMotion ? 1 : 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.12 }}
                >
                  <h2 id="auxiliary-heading" className="px-4 py-4 text-sm font-medium">{activePanel.label}</h2>
                  {activePanel.content}
                </motion.aside>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
        <Separator orientation="vertical" />
        <aside aria-label="Auxiliary panels" className="flex w-12 shrink-0 flex-col items-center gap-2 bg-sidebar py-2">
          {panels.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant={activePanel?.id === id ? "secondary" : "ghost"}
              className="h-auto w-10 flex-col gap-2 py-3"
              aria-label={label}
              title={label}
              aria-expanded={activePanel?.id === id}
              aria-controls={activePanel?.id === id ? "auxiliary-panel" : undefined}
              onClick={() => togglePanel(id)}
            >
              <Icon data-icon="inline-start" />
              <span className="[writing-mode:vertical-rl]">{label}</span>
            </Button>
          ))}
        </aside>
      </div>
      <Separator />
      <footer aria-label="Application footer" className="h-6 shrink-0 bg-sidebar" />
    </div>
  )
}
