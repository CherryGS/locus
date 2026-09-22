import type { ReactNode } from "react"
import { BoxIcon, ChevronRightIcon, MousePointer2Icon, RefreshCwIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/ui/empty"
import { Separator } from "@/shared/ui/separator"
import { Skeleton } from "@/shared/ui/skeleton"
import { Spinner } from "@/shared/ui/spinner"
import { entityLabel, type EntityComponent, type EntityItem } from "../model/entity-item"
import { formatFileSize } from "../lib/format-file-size"
import { formatDuration } from "../lib/format-duration"
import { componentAppearance } from "./component-appearance"
import { DetailSection } from "./detail-fields"

function componentSummary(component: EntityComponent) {
  if (component.previous) return "Previous result · latest read failed"
  if (component.readStatus === "failed") return "Metadata unavailable"
  if (component.readStatus === "loading") return "Reading metadata…"
  switch (component.kind) {
    case "file":
      return component.bytes === undefined ? "Size not observed" : formatFileSize(component.bytes)
    case "image":
    case "video": {
      const values = []
      if (component.width !== undefined && component.height !== undefined)
        values.push(`${component.width.toLocaleString()} × ${component.height.toLocaleString()}`)
      if (component.kind === "video" && component.durationSeconds !== undefined)
        values.push(formatDuration(component.durationSeconds))
      if (component.format) values.push(component.format)
      return (
        values.join(" · ") ||
        (component.record && !component.record.facts
          ? "No accepted interpretation"
          : "Properties not observed")
      )
    }
    case "twitter":
      return component.author?.handle
        ? `@${component.author.handle}`
        : (component.author?.displayName ?? "Author not captured")
    case "unknown":
      return "Read capability unavailable"
  }
}

export function EntityOverview({
  entity,
  viewSelection,
  feedback,
  onReread,
  onOpenComponent,
}: {
  entity: EntityItem | null
  viewSelection?: ReactNode
  feedback?: ReactNode
  onReread?: () => void
  onOpenComponent: (component: EntityComponent) => void
}) {
  if (!entity)
    return (
      <Empty className="px-4 py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <MousePointer2Icon />
          </EmptyMedia>
          <EmptyTitle>No entity selected</EmptyTitle>
          <EmptyDescription>Select an entity to see its details.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  const structurePending = entity.membershipsStatus === "unread" || entity.membershipsStatus === "loading"
  return (
    <div className="flex min-w-0 flex-col pb-1">
      <div className="flex items-start gap-3 px-4 py-5">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h3 className="break-words text-base font-semibold tracking-tight">{entityLabel(entity)}</h3>
          <p className="text-xs text-muted-foreground">
            {structurePending
              ? "Reading components…"
              : entity.membershipsStatus === "missing"
                ? "Entity unavailable"
                : entity.membershipsStatus === "failed"
                  ? "Component list could not be refreshed"
                  : `${entity.components.length} ${entity.components.length === 1 ? "component" : "components"}`}
          </p>
          {entity.loading && (
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Spinner />
              Reading Entity metadata…
            </p>
          )}
        </div>
        {onReread && (
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Reread Entity"
            title="Reread Entity metadata"
            onClick={onReread}
          >
            <RefreshCwIcon />
          </Button>
        )}
      </div>
      {viewSelection && (
        <>
          <Separator />
          <DetailSection title="Default view">{viewSelection}</DetailSection>
        </>
      )}
      {feedback && (
        <>
          <Separator />
          {feedback}
        </>
      )}
      <Separator />
      <DetailSection title="Components">
        {entity.components.length > 0 ? (
          <div className="-mx-2 flex min-w-0 flex-col gap-1">
            {entity.components.map((component) => {
              const { label, icon: Icon } = componentAppearance[component.kind]
              return (
                <Button
                  key={component.id}
                  variant="ghost"
                  className="h-auto w-full items-start justify-start gap-2.5 px-2 py-2.5"
                  aria-label={`Open ${label} details`}
                  onClick={() => onOpenComponent(component)}
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/60">
                    <Icon data-icon="inline-start" className="text-muted-foreground" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
                    <span>{label}</span>
                    <span className="whitespace-normal break-words text-xs font-normal leading-relaxed text-muted-foreground">
                      {componentSummary(component)}
                    </span>
                  </span>
                  {component.readStatus === "loading" ? (
                    <Spinner aria-label="Reading metadata" />
                  ) : (
                    <ChevronRightIcon data-icon="inline-end" className="mt-0.5 text-muted-foreground" />
                  )}
                </Button>
              )
            })}
          </div>
        ) : structurePending ? (
          <div className="flex flex-col gap-2" aria-label="Reading components">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <BoxIcon className="size-4 shrink-0" aria-hidden="true" />
            {entity.membershipsStatus === "missing"
              ? "Entity unavailable"
              : entity.membershipsStatus === "failed"
                ? "Components could not be read."
                : "No components attached."}
          </p>
        )}
      </DetailSection>
    </div>
  )
}
