import { useEffect, useRef, useState, type ReactNode } from "react"
import { motion, useReducedMotion } from "motion/react"
import type { EntityItem, EntitySource } from "@/entities/entity"
import { Button } from "@/shared/ui/button"
import { Empty, EmptyDescription, EmptyHeader } from "@/shared/ui/empty"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/shared/ui/resizable"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { Separator } from "@/shared/ui/separator"
import type { EntityBrowsingState } from "../model/browsing-state"
import { EntityGrid, minimumEntityGridWidth } from "@/entities/entity"
import { entityPanels, type EntityPanelId } from "./entity-panels"
import { CopyIdentityButton } from "@/shared/ui/copy-identity-button"
import { XIcon } from "lucide-react"
import { CivitaiPanelContext } from "./civitai-panel-slot"

export function EntityWorkspace({
  componentFor,
  source,
  browsing,
  selectedEntity,
  viewing,
  onSelect,
  onOpen,
  content,
  viewSelection,
  overviewFeedback,
  onReread,
  gridFeedback,
}: {
  componentFor: (entity: EntityItem) => EntityItem["components"][number]["kind"] | undefined
  source: EntitySource
  browsing?: EntityBrowsingState
  selectedEntity: EntityItem | null
  viewing: boolean
  onSelect: (entity: EntityItem) => void
  onOpen: (entity: EntityItem) => void
  content: ReactNode
  viewSelection: ReactNode
  overviewFeedback?: ReactNode
  onReread?: () => void
  gridFeedback?: ReactNode
}) {
  const [localBrowsing] = useState<EntityBrowsingState>({})
  const retained = browsing ?? localBrowsing
  const [, redraw] = useState(0)
  const activePanelId = retained.panel ?? null
  const setActivePanelId = (id: EntityPanelId | null) => {
    retained.panel = id
    redraw((value) => value + 1)
  }
  const panelTriggers = useRef(new Map<string, HTMLButtonElement>())
  const panels = entityPanels(selectedEntity, viewSelection, {
    feedback: overviewFeedback,
    onReread,
    onOpenComponent: (component) => {
      const id = component.kind === "unknown" ? component.id : component.kind
      panelTriggers.current.get(id)?.focus()
      setActivePanelId(id)
    },
  })
  const missingPanel = activePanelId !== null && !panels.some((panel) => panel.id === activePanelId)
  const activePanel =
    activePanelId === null ? null : (panels.find((panel) => panel.id === activePanelId) ?? panels[0])
  const [panelDefaultWidth, setPanelDefaultWidth] = useState(retained.panelWidth ?? 256)
  // Keep the mounted split pane's default stable during a drag; restore its
  // last live width only when reopening it.
  const lastPanelWidth = useRef(retained.panelWidth ?? 256)
  const reduceMotion = useReducedMotion()
  const [civitaiPanelTarget, setCivitaiPanelTarget] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    if (missingPanel) setActivePanelId("overview")
  }, [missingPanel])

  function togglePanel(id: EntityPanelId) {
    if (activePanel === null) setPanelDefaultWidth(lastPanelWidth.current)
    setActivePanelId(activePanel?.id === id ? null : id)
  }

  return (
    <CivitaiPanelContext
      value={{
        target: civitaiPanelTarget,
        open: () => {
          if (activePanel === null) setPanelDefaultWidth(lastPanelWidth.current)
          setActivePanelId("civitai")
        },
      }}
    >
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
              : (gridFeedback ??
                (source.sequence.length > 0 ? (
                  <EntityGrid
                    componentFor={componentFor}
                    source={source}
                    position={retained.grid}
                    onPosition={(position) => {
                      retained.grid = position
                    }}
                    selectedId={selectedEntity?.id}
                    onSelect={onSelect}
                    onOpen={onOpen}
                    revealSelectionOnMount
                  />
                ) : (
                  <Empty className="h-full">
                    <EmptyHeader>
                      <EmptyDescription>No entities yet.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )))}
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
                onResize={({ inPixels }) => {
                  lastPanelWidth.current = inPixels
                  retained.panelWidth = inPixels
                }}
              >
                <motion.aside
                  id="auxiliary-panel"
                  aria-label={activePanel.label}
                  className="flex h-full min-h-0 flex-col bg-sidebar"
                  initial={{ opacity: reduceMotion ? 1 : 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.12 }}
                >
                  <header className="flex h-12 min-w-0 shrink-0 items-center gap-2 px-4">
                    <activePanel.icon className="size-4 text-muted-foreground" />
                    <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{activePanel.label}</h2>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label="Close details panel"
                      onClick={() => {
                        panelTriggers.current.get(activePanel.id)?.focus()
                        setActivePanelId(null)
                      }}
                    >
                      <XIcon />
                    </Button>
                  </header>
                  <Separator />
                  <ScrollArea key={activePanel.id} className="min-h-0 flex-1">
                    {activePanel.id === "civitai" && (
                      <div ref={setCivitaiPanelTarget} data-slot="civitai-panel-reading" />
                    )}
                    {activePanel.content}
                    {activePanel.identity && (
                      <>
                        <Separator />
                        <section
                          key={activePanel.identity.value}
                          aria-label="Identifiers"
                          className="px-4 py-4"
                        >
                          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                            Identifiers
                          </h3>
                          <div className="mt-3 flex min-w-0 flex-col gap-1">
                            <p className="text-xs text-muted-foreground">{activePanel.identity.label}</p>
                            <CopyIdentityButton {...activePanel.identity} />
                          </div>
                        </section>
                      </>
                    )}
                  </ScrollArea>
                </motion.aside>
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
        <Separator orientation="vertical" />
        <aside
          aria-label="Auxiliary panels"
          className="flex w-12 shrink-0 flex-col items-center gap-1 bg-sidebar py-2"
        >
          {panels.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              ref={(element) => {
                if (element) panelTriggers.current.set(id, element)
                else panelTriggers.current.delete(id)
              }}
              variant={activePanel?.id === id ? "secondary" : "ghost"}
              className="h-auto w-10 flex-col gap-1 py-2"
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
    </CivitaiPanelContext>
  )
}
