import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert"
import { Separator } from "@/shared/ui/separator"
import { Spinner } from "@/shared/ui/spinner"
import type { EntityComponent } from "../model/entity-item"
import { formatFileSize } from "../lib/format-file-size"
import { formatDuration } from "../lib/format-duration"
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
export function EntityComponentDetails({ component }: { component: EntityComponent }) {
  return (
    <div className="flex min-w-0 flex-col pb-1">
      {component.readStatus === "loading" && (
        <p className="flex items-center gap-2 px-4 pt-4 text-xs text-muted-foreground">
          <Spinner />
          Reading metadata…
        </p>
      )}
      {(component.previous || component.readStatus === "failed") && (
        <div className="px-4 pt-4">
          <Alert>
            <AlertTitle>{component.previous ? "Showing previous data" : "Metadata unavailable"}</AlertTitle>
            <AlertDescription>
              {component.previous
                ? "Previous result · the latest reread failed."
                : "The component could not be read."}{" "}
              See Overview for details and recovery.
            </AlertDescription>
          </Alert>
        </div>
      )}
      <ComponentDetailsContent component={component} />
    </div>
  )
}
function ComponentDetailsContent({ component }: { component: EntityComponent }) {
  if (component.kind === "twitter") return <TwitterDetails component={component} />
  if (component.kind === "unknown")
    return (
      <>
        <DetailSection title="Component">
          <p className="text-xs text-muted-foreground">This UI has no reader for this attached kind.</p>
        </DetailSection>
        <Separator />
        <DetailSection title="Membership details">
          <dl>
            <Detail label="Kind ID">{component.kindId}</Detail>
          </dl>
        </DetailSection>
      </>
    )
  const record = "record" in component ? component.record : undefined
  const applicability = "applicability" in component ? component.applicability : undefined
  return (
    <div className="flex min-w-0 flex-col pb-1">
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
                {component.bytes === undefined ? "Not observed" : formatFileSize(component.bytes)}
              </Detail>
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
              {component.kind === "image" &&
                component.width !== undefined &&
                component.height !== undefined && (
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
                          <span className="block text-muted-foreground">
                            Precision: {component.durationPrecision}
                          </span>
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
      {component.kind === "file" && (component.relativePath || component.bytes !== undefined) && (
        <>
          <Separator />
          <DetailSection title="Storage details">
            <dl>
              {component.bytes !== undefined && (
                <Detail label="Exact size">{BigInt(component.bytes).toLocaleString()} bytes</Detail>
              )}
              {component.relativePath && <Detail label="Managed path">{component.relativePath}</Detail>}
            </dl>
          </DetailSection>
        </>
      )}
      {component.kind === "image" &&
        (component.colorMode !== undefined ||
          component.bitsPerChannel !== undefined ||
          component.hasAlphaChannel !== undefined) && (
          <>
            <Separator />
            <DetailSection title="Color">
              <dl>
                {component.colorMode !== undefined && (
                  <Detail label="Color mode">{component.colorMode}</Detail>
                )}
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
          <DetailSection title="Observation details">
            <dl>
              <Detail label="Revision">{record.revision}</Detail>
              <Detail label="Facts basis">{record.basis ?? "No accepted basis"}</Detail>
              <Detail label="Input status">{applicability?.status ?? "Not observed"}</Detail>
              {applicability?.status === "matching" && (
                <Detail label="Current File">{applicability.file_id}</Detail>
              )}
              {applicability?.status === "changed" && (
                <Detail label="Current File">{applicability.current}</Detail>
              )}
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
