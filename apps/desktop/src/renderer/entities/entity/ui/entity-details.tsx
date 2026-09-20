import type { ReactNode } from "react"
import { BoxIcon, FileIcon, ImageIcon, MousePointer2Icon } from "lucide-react"
import { Badge } from "@/shared/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/ui/empty"
import { Separator } from "@/shared/ui/separator"
import type { EntityComponent, EntityItem } from "../model/entity-item"
import { formatFileSize } from "../lib/format-file-size"
import { EntityThumbnail } from "./entity-thumbnail"

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="-mx-1 grid min-h-7 min-w-0 grid-cols-[clamp(4.5rem,36%,5rem)_minmax(0,1fr)] items-baseline gap-3 rounded-md px-1 py-1 transition-colors hover:bg-muted/30">
      <dt className="text-xs leading-5 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-xs leading-5 tabular-nums select-text [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-2 px-4 py-3">
      <h3 className="text-xs font-semibold">{title}</h3>
      {children}
    </section>
  )
}

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

function ImportTime({ value }: { value: string }) {
  const date = new Date(value)
  return (
    <time dateTime={value} title={date.toLocaleString(undefined, { timeZoneName: "short" })}>
      <span className="block">{date.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" })}</span>
      <span className="block text-[11px] leading-4 text-muted-foreground">{date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</span>
    </time>
  )
}

export function EntityOverview({ entity }: { entity: EntityItem | null }) {
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
      <div className="p-4">
        <div className="aspect-[4/3] overflow-hidden rounded-lg bg-muted/20">
          <EntityThumbnail
            src={entity.components.find((component) => component.kind === "image")?.thumbnail}
            hasFile={entity.components.some((component) => component.kind === "file")}
          />
        </div>
      </div>
      <Separator />
      <DetailSection title="Properties">
        <dl><Detail label="Name">{entity.name}</Detail></dl>
      </DetailSection>
      <Separator />
      <DetailSection title="Components">
        <div className="flex flex-wrap gap-2">
          {entity.components.length === 0 ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><BoxIcon className="size-4" aria-hidden="true" />No components</p>
          ) : entity.components.map((component) => (
            <Badge key={component.id} variant="outline">
              {component.kind === "file" ? <FileIcon data-icon="inline-start" /> : <ImageIcon data-icon="inline-start" />}
              {component.kind === "file" ? "File" : "Image"}
            </Badge>
          ))}
        </div>
      </DetailSection>
    </div>
  )
}

export function EntityComponentDetails({ component }: { component: EntityComponent }) {
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
            <Detail label="Imported"><ImportTime value={component.importedAt} /></Detail>
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
