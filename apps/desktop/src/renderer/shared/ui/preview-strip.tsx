import type { ComponentProps, ReactNode, Ref } from "react"
import { StarIcon } from "lucide-react"
import { Button } from "./button"
import { cn } from "@/shared/lib/utils"

export function PreviewStrip({ viewportRef, children, className, ...props }: ComponentProps<"div"> & { viewportRef?: Ref<HTMLDivElement> }) {
  return <div {...props} ref={viewportRef} data-slot="preview-strip-viewport"
    className={cn("h-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>
    {children}
  </div>
}

export type PreviewCoverAction = { marked: boolean; busy?: boolean; disabled?: boolean; label: string; title: string; onToggle: () => void }
export function PreviewStripFrame({ children, cover, className, ...props }: ComponentProps<"div"> & { children: ReactNode; cover?: PreviewCoverAction }) {
  return <div {...props} className={cn("group/gallery-thumbnail relative flex shrink-0", className)} data-card-cover={cover?.marked || undefined} data-cover-editable={!!cover || undefined}>
    {children}
    {cover && <Button variant="frame" size="icon-xs"
      className={cn("absolute -top-3 left-1/2 z-10 -translate-x-1/2", !cover.marked && "opacity-0 group-hover/gallery-thumbnail:opacity-100 group-focus-within/gallery-thumbnail:opacity-100 focus-visible:opacity-100")}
      aria-label={cover.label} aria-pressed={cover.marked} aria-disabled={cover.busy} title={cover.title} disabled={!cover.marked && cover.disabled}
      onClick={() => { if (!cover.busy) cover.onToggle() }}><StarIcon className={cover.marked ? "fill-current" : undefined} /></Button>}
  </div>
}
