import type { ReactNode } from "react"
import { Empty, EmptyDescription, EmptyHeader } from "@/shared/ui/empty"
import type { EntityComponent, EntityItem } from "../model/entity-item"
import { EntityThumbnail } from "./entity-thumbnail"

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm [overflow-wrap:anywhere]">{children}</dd>
    </div>
  )
}

export function EntityOverview({ entity }: { entity: EntityItem | null }) {
  if (!entity) {
    return <Empty className="p-4"><EmptyHeader><EmptyDescription>No entity selected.</EmptyDescription></EmptyHeader></Empty>
  }

  return (
    <div className="flex flex-col gap-5 px-4 pb-4">
      <div className="aspect-[4/3] overflow-hidden rounded-lg bg-muted/20">
        <EntityThumbnail entity={entity} />
      </div>
      <h3 className="break-words text-sm font-medium">{entity.name}</h3>
      <dl className="flex flex-col gap-4">
        <Detail label="Entity ID">{entity.id}</Detail>
        <Detail label="Components">
          {entity.components.map((component) => component.kind === "file" ? "File" : "Image").join(", ") || "None"}
        </Detail>
      </dl>
    </div>
  )
}

export function EntityComponentDetails({ component }: { component: EntityComponent }) {
  return (
    <dl className="flex flex-col gap-4 px-4 pb-4">
      <Detail label="Component ID">{component.id}</Detail>
      {component.kind === "file" ? (
        <>
          <Detail label="Name">{component.name}</Detail>
          <Detail label="Type">{component.mediaType}</Detail>
          <Detail label="Size">{component.bytes.toLocaleString()} bytes</Detail>
        </>
      ) : (
        <>
          <Detail label="Format">{component.format}</Detail>
          <Detail label="Dimensions">{component.width} × {component.height}</Detail>
        </>
      )}
    </dl>
  )
}
