import type { ReactNode } from "react"
import { ArrowLeftIcon } from "lucide-react"
import { TagDocument, type TagDetails, type TagDetailState } from "@/features/tags"
import { Button } from "@/shared/ui/button"
import { Separator } from "@/shared/ui/separator"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/shared/ui/resizable"

export function TagDetailPage({
  coordinator,
  state,
  entities,
  inspecting,
  onReturn,
}: {
  coordinator: TagDetails
  state: TagDetailState
  entities: ReactNode
  inspecting: boolean
  onReturn: () => void
}) {
  return (
    <section aria-label="Tag detail" className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 px-3">
        <Button size="icon-sm" variant="ghost" aria-label="Return to tags" onClick={onReturn}>
          <ArrowLeftIcon />
        </Button>
        <h1 className="min-w-0 truncate text-sm font-medium">
          {state.document?.tag.name ?? "Tag"}
        </h1>
      </header>
      <Separator />
      {inspecting ? (
        <div className="min-h-0 flex-1">{entities}</div>
      ) : (
        <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
          <ResizablePanel defaultSize="38%" minSize="140px">
            <TagDocument coordinator={coordinator} state={state} />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="62%" minSize="180px">
            {entities}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </section>
  )
}
