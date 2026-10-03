import type { ReactNode } from "react"
import { BoxIcon, ChevronRightIcon, MousePointer2Icon, RefreshCwIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/ui/empty"
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
    case "tag":
      return component.record ? `${component.record.tags.length} personal tags` : "Not observed"
    case "civitai":
      return component.record?.model.name ?? "Saved provider information"
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
    case "model":
      return component.record?.facts
        ? `${component.record.facts.format} · ${component.record.facts.tensor_count} ${String(component.record.facts.tensor_count) === "1" ? "tensor" : "tensors"}`
        : "No accepted inspection"
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
  personalTags,
  notes,
  feedback,
  onReread,
  onOpenComponent,
}: {
  entity: EntityItem | null
  viewSelection?: ReactNode
  personalTags?: ReactNode
  notes?: ReactNode
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
          <EmptyTitle>Select an Entity</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  const structurePending = entity.membershipsStatus === "unread" || entity.membershipsStatus === "loading"
  const detailComponents = entity.components.filter((component) => component.kind !== "tag")
  return (
    <div className="flex min-w-0 flex-col pb-1">
      <div className="flex items-start gap-3 px-4 py-5">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h3 className="break-words text-base font-semibold tracking-tight">{entityLabel(entity)}</h3>
          {(structurePending || entity.membershipsStatus === "missing" || entity.membershipsStatus === "failed") && <p className="text-xs text-muted-foreground">
            {structurePending
              ? "Reading components…"
              : entity.membershipsStatus === "missing"
                ? "Entity unavailable"
                : entity.membershipsStatus === "failed"
                  ? "Component list could not be refreshed"
                  : undefined}
          </p>}
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
      {personalTags && <><Separator />{personalTags}</>}
      {notes && <><Separator />{notes}</>}
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
        {detailComponents.length > 0 ? (
          <div className="-mx-2 flex min-w-0 flex-col gap-1">
            {detailComponents.map((component) => {
              const { label, icon: Icon } = componentAppearance[component.kind]
              const summary = componentSummary(component)
              return (
                <Button
                  key={component.id}
                  variant="ghost"
                  className="h-8 w-full min-w-0 justify-start gap-2 px-2"
                  aria-label={`Open ${label} details`}
                  title={`${label}: ${summary}`}
                  onClick={() => onOpenComponent(component)}
                >
                  <Icon data-icon="inline-start" className="text-muted-foreground" />
                  <span className="shrink-0">{label}</span>
                  <span className="min-w-0 flex-1 truncate text-right text-xs font-normal text-muted-foreground">
                    {summary}
                  </span>
                  {component.readStatus === "loading" ? (
                    <Spinner aria-label="Reading metadata" />
                  ) : (
                    <ChevronRightIcon data-icon="inline-end" className="text-muted-foreground" />
                  )}
                </Button>
              )
            })}
          </div>
        ) : structurePending ? (
          <div className="flex flex-col gap-2" aria-label="Reading components">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : (
          <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
            <BoxIcon className="size-4 shrink-0" aria-hidden="true" />
            {entity.membershipsStatus === "missing"
              ? "Entity unavailable"
              : entity.membershipsStatus === "failed"
                ? "Components could not be read."
                : "No component details."}
          </p>
        )}
      </DetailSection>
    </div>
  )
}
