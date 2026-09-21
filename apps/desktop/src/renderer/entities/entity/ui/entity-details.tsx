import type { ReactNode } from "react"
import { BoxIcon, MousePointer2Icon } from "lucide-react"
import { Badge } from "@/shared/ui/badge"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/shared/ui/empty"
import { Separator } from "@/shared/ui/separator"
import { Spinner } from "@/shared/ui/spinner"
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
export function EntityOverview({
  entity,
  viewSelection,
  representedKinds = [],
}: {
  entity: EntityItem | null
  viewSelection?: ReactNode
  representedKinds?: readonly EntityComponent["kind"][]
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
  return (
    <div className="flex min-w-0 flex-col pb-1">
      <DetailSection title="Components">
        {entity.loading && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Spinner />
            Reading Entity metadata…
          </p>
        )}
        {viewSelection}
        <div className="flex flex-wrap gap-2">
          {entity.components.length === 0 &&
          entity.membershipsStatus !== "loading" &&
          entity.membershipsStatus !== "unread" &&
          entity.membershipsStatus !== "failed" ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <BoxIcon className="size-4" aria-hidden="true" />
              {entity.membershipsStatus === "missing" ? "Entity unavailable" : "No components"}
            </p>
          ) : (
            entity.components
              .filter((component) => !representedKinds.includes(component.kind))
              .map((component) => {
                const { label, icon: Icon } = componentAppearance[component.kind]
                return (
                  <Badge key={component.id} variant="outline">
                    <Icon data-icon="inline-start" />
                    {label}
                  </Badge>
                )
              })
          )}
        </div>
      </DetailSection>
      {entity.name && (
        <>
          <Separator />
          <DetailSection title="Properties">
            <dl>
              <Detail label="Name">{entity.name}</Detail>
            </dl>
          </DetailSection>
        </>
      )}
    </div>
  )
}
export function EntityComponentDetails({ component }: { component: EntityComponent }) {
  if (component.kind === "twitter") return <TwitterDetails component={component} />
  if (component.kind === "unknown")
    return (
      <DetailSection title="Membership">
        <dl>
          <Detail label="Kind ID">{component.kindId}</Detail>
        </dl>
        <p className="text-xs text-muted-foreground">This UI has no reader for this attached kind.</p>
      </DetailSection>
    )
  const record = "record" in component ? component.record : undefined
  const applicability = "applicability" in component ? component.applicability : undefined
  return (
    <div className="flex min-w-0 flex-col pb-1">
      {component.readStatus === "loading" && (
        <div className="flex items-center gap-2 px-4 pt-3 text-xs text-muted-foreground">
          <Spinner />
          Reading metadata…
        </div>
      )}
      {component.previous && (
        <p className="px-4 pt-3 text-xs text-muted-foreground">Previous result · the latest reread failed.</p>
      )}
      <DetailSection title="Properties">
        <dl>
          {component.kind === "file" ? (
            <>
              {component.originalName && (
                <>
                  <Detail label="Name">{component.originalName}</Detail>
                  <Detail label="Extension">{fileExtension(component.originalName)}</Detail>
                </>
              )}
              <Detail label="Size">
                {component.bytes === undefined ? (
                  "Not observed"
                ) : (
                  <>
                    <span className="block">{formatFileSize(component.bytes)}</span>
                    <span className="block text-muted-foreground">
                      {BigInt(component.bytes).toLocaleString()} bytes
                    </span>
                  </>
                )}
              </Detail>
              {component.relativePath && <Detail label="Managed path">{component.relativePath}</Detail>}
              {component.importedAt && (
                <Detail label="Imported">
                  <DetailTime value={component.importedAt} />
                </Detail>
              )}
            </>
          ) : (
            <>
              {record && !record.facts && <Detail label="Interpretation">No accepted interpretation</Detail>}
              <Detail label="Format">{component.format ?? "Unknown"}</Detail>
              <Detail label="Dimensions">
                {component.width !== undefined && component.height !== undefined
                  ? `${component.width.toLocaleString()} × ${component.height.toLocaleString()} px`
                  : "Unknown"}
              </Detail>
              {component.kind === "image" && component.width !== undefined && component.height !== undefined && (
                <>
                  <Detail label="Aspect ratio">{aspectRatio(component.width, component.height)}</Detail>
                  <Detail label="Pixels">
                    {(BigInt(component.width) * BigInt(component.height)).toLocaleString()} pixels
                  </Detail>
                </>
              )}
              {component.kind === "video" && (
                <>
                  <Detail label="Stream">{component.streamIndex ?? "Unknown"}</Detail>
                  <Detail label="Duration">
                    {component.durationSeconds === undefined ? (
                      "Unknown"
                    ) : (
                      <>
                        {formatDuration(component.durationSeconds)}
                        {component.durationPrecision && (
                          <span className="block text-muted-foreground">Precision: {component.durationPrecision}</span>
                        )}
                      </>
                    )}
                  </Detail>
                  {component.frameRate !== undefined && (
                    <Detail label="Frame rate">{component.frameRate.toLocaleString()} fps</Detail>
                  )}
                  <Detail label="Codec">{component.codec ?? "Unknown"}</Detail>
                </>
              )}
            </>
          )}
        </dl>
      </DetailSection>
      {component.kind === "image" &&
        (component.colorMode !== undefined ||
          component.bitsPerChannel !== undefined ||
          component.hasAlphaChannel !== undefined) && (
          <>
            <Separator />
            <DetailSection title="Color">
              <dl>
                {component.colorMode !== undefined && <Detail label="Color mode">{component.colorMode}</Detail>}
                {component.bitsPerChannel !== undefined && (
                  <Detail label="Bit depth">{component.bitsPerChannel}-bit per channel</Detail>
                )}
                {component.hasAlphaChannel !== undefined && (
                  <Detail label="Alpha channel">{component.hasAlphaChannel ? "Yes" : "No"}</Detail>
                )}
              </dl>
            </DetailSection>
          </>
        )}
      {record && (
        <>
          <Separator />
          <DetailSection title="Observation">
            <dl>
              <Detail label="Revision">{record.revision}</Detail>
              <Detail label="Facts basis">{record.basis ?? "No accepted basis"}</Detail>
              <Detail label="Input status">{applicability?.status ?? "Not observed"}</Detail>
              {applicability?.status === "matching" && <Detail label="Current File">{applicability.file_id}</Detail>}
              {applicability?.status === "changed" && <Detail label="Current File">{applicability.current}</Detail>}
              {applicability?.status === "incomplete" && (
                <Detail label="Current File">
                  {applicability.current.status === "file"
                    ? applicability.current.file_id
                    : applicability.current.status.replaceAll("_", " ")}
                </Detail>
              )}
              {record.last_failure && (
                <Detail label="Last attempt">
                  {record.last_failure.detail} ({record.last_failure.code})
                </Detail>
              )}
            </dl>
          </DetailSection>
        </>
      )}
    </div>
  )
}
