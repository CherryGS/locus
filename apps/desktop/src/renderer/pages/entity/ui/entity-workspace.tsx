import { useEffect, useRef, useState, type ReactNode } from "react"
import { motion, useReducedMotion } from "motion/react"
import type { EntityItem } from "@/entities/entity"
import { Button } from "@/shared/ui/button"
import { Empty, EmptyDescription, EmptyHeader } from "@/shared/ui/empty"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/shared/ui/resizable"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { Separator } from "@/shared/ui/separator"
import { EntityGrid } from "./entity-grid"
import { minimumEntityGridWidth } from "./entity-grid-layout"
import { entityPanels, type EntityPanelId } from "./entity-panels"
import { CopyIdentityButton } from "@/shared/ui/copy-identity-button"

export function EntityWorkspace({ entities, selectedEntity, viewing, onSelect, onOpen, content, viewSelection }: {
  entities: readonly EntityItem[]
  selectedEntity: EntityItem | null
  viewing: boolean
  onSelect: (entity: EntityItem) => void
  onOpen: (entity: EntityItem) => void
  content: ReactNode
  viewSelection: ReactNode
}) {
  const panels = entityPanels(selectedEntity, viewSelection)
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
      <ResizablePanelGroup
        orientation="horizontal"
        className="min-w-0 flex-1"
        // The separator owns its whole hit area. Expanding into its neighboring
        // scrollbar lets the same pointer-down start both resize and scrolling.
        resizeTargetMinimumSize={{ fine: 0, coarse: 0 }}
      >
        <ResizablePanel id="entity-grid-panel" minSize={minimumEntityGridWidth}>
          {viewing
            ? content
            : entities.length > 0
            ? <EntityGrid entities={entities} selectedId={selectedEntity?.id} onSelect={onSelect} onOpen={onOpen} revealSelectionOnMount={selectedEntity !== null} />
            : <Empty className="h-full"><EmptyHeader><EmptyDescription>No entities yet.</EmptyDescription></EmptyHeader></Empty>}

        </ResizablePanel>
        {activePanel && (
          <>
            <ResizableHandle
              aria-label="Resize auxiliary panel"
              className="w-2.5 border-l bg-sidebar after:hidden [@media(pointer:coarse)]:w-5"
            />
            <ResizablePanel
              id="auxiliary-content"
              defaultSize={panelDefaultWidth}
              minSize="12rem"
              groupResizeBehavior="preserve-pixel-size"
              onResize={({ inPixels }) => { lastPanelWidth.current = inPixels }}
            >
              <motion.aside
                id="auxiliary-panel"
                aria-label={activePanel.label}
                className="flex h-full min-h-0 flex-col bg-sidebar"
                initial={{ opacity: reduceMotion ? 1 : 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.12 }}
              >
                {activePanel.identity && (
                  <>
                    <header className="flex h-11 min-w-0 shrink-0 items-center px-4">
                      <CopyIdentityButton key={activePanel.identity.value} {...activePanel.identity} />
                    </header>
                    <Separator />
                  </>
                )}
                <ScrollArea key={activePanel.id} className="min-h-0 flex-1">
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
