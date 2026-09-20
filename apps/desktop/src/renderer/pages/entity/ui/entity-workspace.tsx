import { useEffect, useRef, useState } from "react"
import { motion, useReducedMotion } from "motion/react"
import type { EntityItem } from "@/entities/entity"
import { useEntitySelection } from "@/features/entity-selection"
import { Button } from "@/shared/ui/button"
import { Empty, EmptyDescription, EmptyHeader } from "@/shared/ui/empty"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/shared/ui/resizable"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { Separator } from "@/shared/ui/separator"
import { EntityGrid } from "./entity-grid"
import { minimumEntityGridWidth } from "./entity-grid-layout"
import { entityPanels, type EntityPanelId } from "./entity-panels"

export function EntityWorkspace({ entities }: { entities: readonly EntityItem[] }) {
  const { selectedEntity, selectEntity } = useEntitySelection()
  const panels = entityPanels(selectedEntity)
  const [activePanelId, setActivePanelId] = useState<EntityPanelId | null>(null)
  const missingPanel = activePanelId !== null && !panels.some((panel) => panel.id === activePanelId)
  const activePanel = activePanelId === null ? null : panels.find((panel) => panel.id === activePanelId) ?? panels[0]
  const [panelDefaultWidth, setPanelDefaultWidth] = useState(256)
  // Keep the mounted split pane's default stable during a drag; restore its
  // last live width only when reopening it.
  const lastPanelWidth = useRef(256)
  const reduceMotion = useReducedMotion()

  useEffect(() => { if (missingPanel) setActivePanelId("overview") }, [missingPanel])

  function togglePanel(id: EntityPanelId) {
    if (activePanel === null) setPanelDefaultWidth(lastPanelWidth.current)
    setActivePanelId(activePanel?.id === id ? null : id)
  }

  return (
    <div data-slot="entity-workspace" className="flex min-h-0 flex-1">
      <ResizablePanelGroup orientation="horizontal" className="min-w-0 flex-1">
        <ResizablePanel id="entity-grid-panel" minSize={minimumEntityGridWidth}>
          {entities.length > 0
            ? <EntityGrid entities={entities} selectedId={selectedEntity?.id} onSelect={selectEntity} />
            : <Empty className="h-full"><EmptyHeader><EmptyDescription>No entities yet.</EmptyDescription></EmptyHeader></Empty>}
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
                className="h-full bg-sidebar"
                initial={{ opacity: reduceMotion ? 1 : 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.12 }}
              >
                <ScrollArea className="h-full">
                  <h2 id="auxiliary-heading" className="px-4 py-4 text-sm font-medium">{activePanel.label}</h2>
                  {activePanel.content}
                </ScrollArea>
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
  )
}
