import { BoxIcon, CircleAlertIcon, ImagesIcon, LayersIcon, PlusIcon, TagsIcon, XIcon } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs"
import { Button } from "@/shared/ui/button"
import type { PageCategory, WorkspaceSession } from "../providers/workspace-session"

const pageIcons = { Media: ImagesIcon, Models: BoxIcon, "All content": LayersIcon, Tags: TagsIcon } satisfies Record<PageCategory, typeof ImagesIcon>

/** A tab owns one continuous surface; its close action is a sibling hit target. */
export function WorkspaceTabs({ workspace }: { workspace?: WorkspaceSession }) {
  return <Tabs value={workspace?.activeId ?? null}
    onValueChange={id => { if (typeof id === "string") workspace?.activate(id) }} className="workspace-tabs">
    <TabsList aria-label="Workspace tabs" className="workspace-tab-list">
      {workspace?.pages.map(page => {
        const Icon = pageIcons[page.category]
        return <div key={page.id} className="workspace-tab" data-active={page.active}>
          <TabsTrigger id={`workspace-tab-${page.id}`} aria-controls={`workspace-panel-${page.id}`}
            value={page.id} className="workspace-tab-trigger" title={page.label}>
            <Icon aria-hidden="true" />
            <span className="truncate">{page.label}</span>
          </TabsTrigger>
          {page.attention && <Button variant="ghost" size="icon-xs" className="workspace-tab-attention"
            aria-label={`Resolve ${page.label} edits`} title="Edits need attention"
            onClick={() => workspace.resolveAttention(page)}><CircleAlertIcon /></Button>}
          <Button variant="ghost" size="icon-xs" className="workspace-tab-close"
            aria-label={`Close ${page.label}`} title={`Close ${page.label}`}
            onClick={() => void workspace.requestClose(page)}><XIcon /></Button>
        </div>
      })}
    </TabsList>
    <Button variant="ghost" size="icon-sm" className="workspace-tab-new" aria-label="Open page"
      title="Open All content" onClick={() => workspace?.open("All content")}><PlusIcon /></Button>
  </Tabs>
}
