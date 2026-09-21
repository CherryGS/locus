import type { ReactNode } from "react"
import { BoxIcon, MousePointer2Icon } from "lucide-react"
import { Badge } from "@/shared/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/ui/empty"
import { Separator } from "@/shared/ui/separator"
import type { EntityComponent, EntityItem } from "../model/entity-item"
import { formatFileSize } from "../lib/format-file-size"
import { formatDuration } from "../lib/format-duration"
import { componentAppearance } from "./component-appearance"
import { Detail, DetailSection, DetailTime } from "./detail-fields"
import { TwitterDetails } from "./twitter-details"

function fileExtension(name: string) {
  const dot = name.lastIndexOf(".")
  return dot > 0 && dot < name.length - 1 ? name.slice(dot) : "None"
}

function aspectRatio(width: number, height: number) {
  let a = width
  let b = height
  while (b !== 0) [a, b] = [b, a % b]
  return `${width / a}:${height / a}`
}

export function EntityOverview({ entity, viewSelection }: { entity: EntityItem | null; viewSelection?: ReactNode }) {
  if (!entity) {
    return (
      <Empty className="px-4 py-10">
        <EmptyHeader>
          <EmptyMedia variant="icon"><MousePointer2Icon /></EmptyMedia>
          <EmptyTitle>No entity selected</EmptyTitle>
          <EmptyDescription>Select an entity to see its details.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }

  return (
    <div className="flex min-w-0 flex-col pb-1">
      <DetailSection title="Components">
        {viewSelection ?? <div className="flex flex-wrap gap-2">
          {entity.components.length === 0 ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><BoxIcon className="size-4" aria-hidden="true" />No components</p>
          ) : entity.components.map((component) => {
            const { label, icon: Icon } = componentAppearance[component.kind]
            return (
              <Badge key={component.id} variant="outline">
                <Icon data-icon="inline-start" />
                {label}
              </Badge>
            )
          })}
        </div>}
      </DetailSection>
      <Separator />
      <DetailSection title="Properties">
        <dl><Detail label="Name">{entity.name}</Detail></dl>
      </DetailSection>
    </div>
  )
}

export function EntityComponentDetails({ component }: { component: EntityComponent }) {
  if (component.kind === "twitter") return <TwitterDetails component={component} />
  return (
    <div className="flex min-w-0 flex-col pb-1">
      {component.kind === "file" ? (
        <DetailSection title="Properties">
          <dl>
            <Detail label="Name">{component.originalName}</Detail>
            <Detail label="Extension">{fileExtension(component.originalName)}</Detail>
            <Detail label="Size">
              <span className="block">{formatFileSize(component.bytes)}</span>
              {component.bytes >= 1024 && <span className="block text-[11px] leading-4 text-muted-foreground">{component.bytes.toLocaleString()} bytes</span>}
            </Detail>
            <Detail label="Imported"><DetailTime value={component.importedAt} /></Detail>
          </dl>
        </DetailSection>
      ) : component.kind === "video" ? (
        <DetailSection title="Properties">
          <dl>
            <Detail label="Format">{component.format ?? "Unknown"}</Detail>
            <Detail label="Dimensions">
              {component.width && component.height
                ? `${component.width.toLocaleString()} × ${component.height.toLocaleString()} px`
                : "Unknown"}
            </Detail>
            <Detail label="Duration">
              {component.durationSeconds === undefined ? "Unknown" : formatDuration(component.durationSeconds)}
            </Detail>
            <Detail label="Frame rate">
              {component.frameRate === undefined ? "Unknown" : `${component.frameRate.toLocaleString(undefined, { maximumFractionDigits: 3 })} fps`}
            </Detail>
            <Detail label="Codec">{component.codec ?? "Unknown"}</Detail>
          </dl>
        </DetailSection>
      ) : (
        <>
          <DetailSection title="Properties">
            <dl>
              <Detail label="Format">{component.format}</Detail>
              <Detail label="Dimensions">{component.width.toLocaleString()} × {component.height.toLocaleString()} px</Detail>
              <Detail label="Aspect ratio">{aspectRatio(component.width, component.height)}</Detail>
              <Detail label="Pixels">
                <span className="block">{(component.width * component.height / 1_000_000).toLocaleString(undefined, { maximumSignificantDigits: 3 })} MP</span>
                <span className="block text-[11px] leading-4 text-muted-foreground">{(component.width * component.height).toLocaleString()} pixels</span>
              </Detail>
            </dl>
          </DetailSection>
          <Separator />
          <DetailSection title="Color">
            <dl>
              <Detail label="Color mode">{component.colorMode}</Detail>
              <Detail label="Bit depth">
                <span className="block">{component.bitsPerChannel}-bit</span>
                <span className="block text-[11px] leading-4 text-muted-foreground">per channel</span>
              </Detail>
              <Detail label="Alpha channel">{component.hasAlphaChannel ? "Yes" : "No"}</Detail>
            </dl>
          </DetailSection>
        </>
      )}
    </div>
  )
}
