import { HeaderDisplayPlacement } from "@/shared/page-tools"
import { usePageActivity } from "@/shared/page-activity"
import { useEffect, type ReactNode } from "react"
import { ArrowLeftIcon, RefreshCwIcon } from "lucide-react"
import {
  TagDocument,
  TagDocumentActions,
  type TagDetails,
  type TagDetailState,
} from "@/features/tags"
import { Button } from "@/shared/ui/button"
import { Separator } from "@/shared/ui/separator"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { HeaderDisplay } from "@/shared/ui/header-display"
import { Spinner } from "@/shared/ui/spinner"
import { useSourceReturn } from "@/shared/source-return"

export function TagDetailPage({
  coordinator,
  state,
  entities,
  controls,
  onRefresh,
  onReturn,
}: {
  coordinator: TagDetails
  state: TagDetailState
  entities: ReactNode
  controls: ReactNode
  onRefresh: () => void
  onReturn: () => void
}) {
  useSourceReturn(onReturn)
  const { active } = usePageActivity()
  useEffect(() => {
    if (!active) return
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
  }, [onReturn, active])
  return (
    <section aria-label="Tag detail" className="flex h-full min-h-0 flex-col">
      <HeaderDisplay><span aria-label="Browsing status" className="truncate">{state.sequence ? `${state.sequence.length.toLocaleString()} tagged ${state.sequence.length === 1 ? "item" : "items"}${state.entityId ? " · 1 selected" : ""}` : "Tag"}</span></HeaderDisplay>
      <header
        aria-label="Tag page tools"
        className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 px-3 py-1.5"
      >
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Return to tags"
          title="Return to tags (Esc)"
          onClick={onReturn}
        >
          <ArrowLeftIcon />
        </Button>
        <h1 className="min-w-12 flex-1 truncate text-sm font-medium">
          {state.document?.tag.name ?? "Tag"}
        </h1>
        <TagDocumentActions coordinator={coordinator} state={state} />
        {controls}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Refresh tag page"
          title="Refresh tag page"
          disabled={state.documentPending || state.queryPending || coordinator.unresolved(state)}
          onClick={onRefresh}
        >
          {state.documentPending || state.queryPending ? <Spinner /> : <RefreshCwIcon />}
        </Button>
        <HeaderDisplayPlacement />
      </header>
      <Separator data-boundary="page" />
      {entities}
      <Separator />
      <div className="min-h-0 flex-1 px-3 pt-3 pb-2">
        <ScrollArea
          data-description-frame
          className="h-full rounded-lg border border-border bg-muted/20"
          viewportProps={{ "aria-label": "Description area" }}
        >
          <TagDocument coordinator={coordinator} state={state} />
        </ScrollArea>
      </div>
    </section>
  )
}
