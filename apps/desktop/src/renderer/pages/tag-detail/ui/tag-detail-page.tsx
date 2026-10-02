import { useEffect, type ReactNode } from "react"
import { ArrowLeftIcon } from "lucide-react"
import { TagDocument, type TagDetails, type TagDetailState } from "@/features/tags"
import { Button } from "@/shared/ui/button"
import { Separator } from "@/shared/ui/separator"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/shared/ui/resizable"
import { useSourceReturn } from "@/shared/source-return"

export function TagDetailPage({
  coordinator,
  state,
  entities,
  onReturn,
}: {
  coordinator: TagDetails
  state: TagDetailState
  entities: ReactNode
  onReturn: () => void
}) {
  useSourceReturn(onReturn)
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        document.fullscreenElement ||
        document.querySelector(
          '[data-slot="dialog-content"][data-open], [role="menu"], [data-slot="select-content"], [data-slot="popover-content"], .milkdown-slash-menu[data-show="true"], .milkdown-link-edit[data-show="true"]',
        )
      )
        return
      event.preventDefault()
      event.stopPropagation()
      onReturn()
    }
    // ProseMirror uses Escape for parent selection; page return takes precedence
    // once the editor's actual menus and the application's dialogs are closed.
    window.addEventListener("keydown", escape, true)
    return () => window.removeEventListener("keydown", escape, true)
  }, [onReturn])
  return (
    <section aria-label="Tag detail" className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 px-3">
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Return to tags"
          title="Return to tags (Esc)"
          onClick={onReturn}
        >
          <ArrowLeftIcon />
        </Button>
        <h1 className="min-w-0 truncate text-sm font-medium">
          {state.document?.tag.name ?? "Tag"}
        </h1>
      </header>
      <Separator />
      <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
        <ResizablePanel defaultSize="38%" minSize="140px">
          <TagDocument coordinator={coordinator} state={state} />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize="62%" minSize="180px">
          {entities}
        </ResizablePanel>
      </ResizablePanelGroup>
    </section>
  )
}
