import { BilibiliDetails } from "./bilibili-details"
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert"
import { Separator } from "@/shared/ui/separator"
import { Spinner } from "@/shared/ui/spinner"
import type { EntityComponent } from "../model/entity-item"
import { diagnosticText } from "@/shared/api"
import { formatDuration } from "../lib/format-duration"
import { Detail, DetailFileSize, DetailIdentifier, DetailSection, DetailTime } from "./detail-fields"
import { TwitterDetails } from "./twitter-details"
import { cn } from "@/shared/lib/utils"
import { CivitaiLocalMatch } from "./civitai-local-match"
import { useDelayedPending } from "@/shared/lib/use-delayed-pending"

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
export function EntityComponentDetails({
  component,
  showIdentity = true,
  showFileName = true,
  showCivitaiObservation = true,
  className,
}: {
  component: EntityComponent
  /** Non-File auxiliary panels let the shell supply their Component ID. */
  showIdentity?: boolean
  /** The File content view already names the file in its heading. */
  showFileName?: boolean
  /** The active Civitai reader places provenance below its source panel. */
  showCivitaiObservation?: boolean
  className?: string
}) {
  const loading = useDelayedPending(component.readStatus === "loading")
  const retained = "record" in component ? !!component.record : component.kind === "file" && component.bytes !== undefined
  // The active Civitai reader owns contextual correspondence and provenance.
  if (component.kind === "civitai" && !showCivitaiObservation) return null
  return (
    <div className={cn("flex min-w-0 flex-col pb-1", className)}>
      {loading && !retained && (
        <p className="flex items-center gap-2 px-4 pt-4 text-xs text-muted-foreground">
          <Spinner />
          Reading metadata…
        </p>
      )}
      <span role="status" className="sr-only">{loading && retained ? "Refreshing metadata" : undefined}</span>
      {(component.previous || component.readStatus === "failed") && (
        <div className="px-4 pt-4">
          <Alert>
            <AlertTitle>
              {component.previous ? "Showing previous data" : "Metadata unavailable"}
            </AlertTitle>
            <AlertDescription>
              {component.previous
                ? "Previous result · the latest reread failed."
                : "The component could not be read."}{" "}
              See Overview for details and recovery.
            </AlertDescription>
          </Alert>
        </div>
      )}
      <ComponentDetailsContent component={component} showIdentity={showIdentity} showFileName={showFileName} showCivitaiObservation={showCivitaiObservation} />
    </div>
  )
}
function ComponentDetailsContent({
  component,
  showIdentity,
  showFileName,
  showCivitaiObservation,
}: {
  component: EntityComponent
  showIdentity: boolean
  showFileName: boolean
  showCivitaiObservation: boolean
}) {
  if (component.kind === "tag")
    return (
      <DetailSection title="Personal Tag set">
        <dl>
          {showIdentity && (
            <Detail label="Component">
              <DetailIdentifier label="Component ID" value={component.id} />
            </Detail>
          )}
          {component.record?.tags.map((tag) => (
            <Detail key={tag.id} label={tag.name}>
              <DetailIdentifier label={`Tag ${tag.name}`} value={tag.id} />
            </Detail>
          ))}
        </dl>
        {component.record?.tags.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No assigned tags. The empty set remains retained.
          </p>
        )}
      </DetailSection>
    )
  if (component.kind === "civitai") {
    return (
      <>
        <CivitaiLocalMatch component={component} />
        {showCivitaiObservation && <>
        <Separator />
        <DetailSection title="Observation details">
          <dl>
            {showIdentity && (
              <Detail label="Component">
                <DetailIdentifier label="Component ID" value={component.id} />
              </Detail>
            )}
            <Detail label="Accepted File">
              {component.record?.file_id ? (
                <DetailIdentifier label="Accepted File" value={component.record.file_id} />
              ) : (
                "Not observed"
              )}
            </Detail>
            <Detail label="Observation">
              {component.record?.observation ? (
                <DetailIdentifier label="Observation" value={component.record.observation} />
              ) : (
                "Not observed"
              )}
            </Detail>
          </dl>
        </DetailSection>
        </>}
      </>
    )
  }
  if (component.kind === "model")
    return (
      <>
        <DetailSection title="Properties">
          <dl>
            <Detail label="Format">{component.record?.facts?.format ?? "Not observed"}</Detail>
            <Detail label="Tensors">{component.record?.facts ? BigInt(component.record.facts.tensor_count).toLocaleString() : "Not observed"}</Detail>
            <Detail label="Stored elements">{component.record?.facts ? BigInt(component.record.facts.element_count).toLocaleString() : "Not observed"}</Detail>
          </dl>
        </DetailSection>
        <Separator />
        <DetailSection title="Observation details">
          <dl>
            {showIdentity && (
              <Detail label="Component">
                <DetailIdentifier label="Component ID" value={component.id} />
              </Detail>
            )}
            <Detail label="Actual host">
              {component.host ? (
                <DetailIdentifier label="Actual host" value={component.host} />
              ) : (
                "Not observed"
              )}
            </Detail>
            <Detail label="Accepted File basis">
              {component.record ? (
                component.record.basis ? (
                  <DetailIdentifier label="Accepted File basis" value={component.record.basis} />
                ) : (
                  "No accepted basis"
                )
              ) : (
                "Not observed"
              )}
            </Detail>
            <Detail label="Revision">{component.record?.revision ?? "Not observed"}</Detail>
            <Detail label="Input status">{component.applicability?.status ?? "Not observed"}</Detail>
            {component.record?.last_failure && <Detail label="Last attempt">{component.record.last_failure.detail} ({component.record.last_failure.code})</Detail>}
            {component.fileProblem && <Detail label="File problem">{diagnosticText(component.fileProblem)}</Detail>}
          </dl>
        </DetailSection>
      </>
    )
  if (component.kind === "bilibili")
    return <BilibiliDetails component={component} showIdentity={showIdentity} />
  if (component.kind === "twitter") return <TwitterDetails key={component.id} component={component} />
  if (component.kind === "unknown")
    return (
      <>
        <DetailSection title="Component">
          <p className="text-xs text-muted-foreground">This UI has no reader for this attached kind.</p>
        </DetailSection>
        <Separator />
        <DetailSection title="Membership details">
          <dl>
            <Detail label="Kind ID">
              <DetailIdentifier label="Kind ID" value={component.kindId} />
            </Detail>
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
                  {showFileName && <Detail label="Name">{component.originalName}</Detail>}
                  <Detail label="Extension">{fileExtension(component.originalName)}</Detail>
                </>
              )}
              <Detail label="Size">
                {component.bytes === undefined ? "Not observed" : <DetailFileSize value={component.bytes} />}
              </Detail>
              {component.importedAt && (
                <Detail label="Imported">
                  <DetailTime value={component.importedAt} />
                </Detail>
              )}
            </>
          ) : (
            <>
              {record && !record.facts && (
                <Detail label="Interpretation">No accepted interpretation</Detail>
              )}
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
                    <Detail label="Aspect ratio">
                      {aspectRatio(component.width, component.height)}
                    </Detail>
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
                        <span title={`${component.durationSeconds} seconds`}>
                          {formatDuration(component.durationSeconds)}
                        </span>
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
      {component.kind === "file" && (component.relativePath || showIdentity) && (
        <>
          <Separator />
          <DetailSection title="Storage details">
            <dl>
              {component.relativePath && (
                <Detail label="Managed path">
                  <code className="text-xs">{component.relativePath}</code>
                </Detail>
              )}
              {showIdentity && <Detail label="Component ID"><DetailIdentifier label="Component ID" value={component.id} /></Detail>}
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
              <Detail label="Facts basis">
                {record.basis ? (
                  <DetailIdentifier label="Facts basis" value={record.basis} />
                ) : (
                  "No accepted basis"
                )}
              </Detail>
              <Detail label="Input status">{applicability?.status ?? "Not observed"}</Detail>
              {applicability?.status === "error" && <Detail label="Problem">{diagnosticText(applicability.diagnostic)}</Detail>}
              {applicability?.status === "matching" && (
                <Detail label="Current File">
                  <DetailIdentifier label="Current File" value={applicability.file_id} />
                </Detail>
              )}
              {applicability?.status === "changed" && (
                <Detail label="Current File">
                  <DetailIdentifier label="Current File" value={applicability.current} />
                </Detail>
              )}
              {applicability?.status === "incomplete" && (
                <Detail label="Current File">
                  {applicability.current.status === "file" ? (
                    <DetailIdentifier label="Current File" value={applicability.current.file_id} />
                  ) : (
                    applicability.current.status.replaceAll("_", " ")
                  )}
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
