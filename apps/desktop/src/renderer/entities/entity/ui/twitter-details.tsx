import type { Wire } from "@/shared/api"
import { Separator } from "@/shared/ui/separator"
import { CopyIdentityButton } from "@/shared/ui/copy-identity-button"
import { Detail, DetailSection, DetailTime } from "./detail-fields"
import { CapturedText, SourceLink, twitterReferenceLabels, type TwitterComponent } from "./twitter-fields"

export function TwitterDetails({ component }: { component: TwitterComponent }) {
  if (component.readStatus && !component.record) return null
  const author = component.author
  const snapshot = component.record?.snapshot
  return (
    <div className="flex min-w-0 flex-col pb-1">
      <DetailSection title="Post">
        <p className="text-xs text-muted-foreground">Saved capture</p>
        <dl>
          <Detail label="Subject page">
            <SourceLink url={component.postUrl}>Open post</SourceLink>
          </Detail>
        </dl>
      </DetailSection>
      <Separator />
      <DetailSection title="Author">
        <dl>
          <Detail label="Name">
            <CapturedText value={author?.displayName} />
          </Detail>
          <Detail label="Username">
            <CapturedText value={author?.handle ? `@${author.handle}` : author?.handle} />
          </Detail>
          <Detail label="Profile">
            <SourceLink url={author?.profileUrl}>Open profile</SourceLink>
          </Detail>
        </dl>
      </DetailSection>
      <Separator />
      <DetailSection title="Dates">
        <dl>
          <Detail label="Published">
            {component.publishedAt ? (
              <DetailTime value={component.publishedAt} />
            ) : (
              <CapturedText value={undefined} />
            )}
          </Detail>
          <Detail label="Observed">
            {component.capturedAt ? (
              <DetailTime value={component.capturedAt} />
            ) : (
              <CapturedText value={undefined} />
            )}
          </Detail>
        </dl>
      </DetailSection>
      <Separator />
      <DetailSection title="Captured media occurrence">
        <dl>
          <Detail label="Position">
            {component.sourceOrder === undefined ? (
              <CapturedText value={undefined} />
            ) : (
              `#${component.sourceOrder + 1}`
            )}
          </Detail>
          <Detail label="ALT">
            <CapturedText value={component.altText} />
          </Detail>
        </dl>
      </DetailSection>
      <Separator />
      <DetailSection title="References">
        {component.references === undefined ? (
          <p className="text-xs text-muted-foreground">Not captured</p>
        ) : component.references.length === 0 ? (
          <p className="text-xs text-muted-foreground">None</p>
        ) : (
          <dl>
            {component.references.map((reference, index) => (
              <Detail key={index} label={twitterReferenceLabels[reference.kind]}>
                {reference.url ? (
                  <SourceLink url={reference.url}>Open post</SourceLink>
                ) : (
                  <CapturedText value={reference.postId} />
                )}
              </Detail>
            ))}
          </dl>
        )}
      </DetailSection>
      {snapshot && (
        <>
          <Separator />
          <DetailSection title="Capture context">
            <dl>
              <Detail label="Requested URL">
                <SourceLink url={snapshot.requested_url ?? undefined} />
              </Detail>
              <Detail label="Hashtags">
                <CapturedText value={snapshot.hashtags?.join(" · ")} />
              </Detail>
            </dl>
          </DetailSection>
          <Separator />
          <DetailSection title="Occurrence claims">
            <dl>
              <Detail label="Platform media ID">
                <CapturedText value={snapshot.occurrence?.media_id ?? undefined} />
              </Detail>
              <Detail label="Capture-local ID">
                <CapturedText value={snapshot.occurrence?.capture_local_id ?? undefined} />
              </Detail>
              <Detail label="Source label">
                <CapturedText value={snapshot.occurrence?.label?.replaceAll("_", " ")} />
              </Detail>
              <CapturedClaims claims={snapshot.occurrence?.claims} />
            </dl>
          </DetailSection>
          <Separator />
          <DetailSection title="Selected representation">
            <dl>
              <Detail label="URL">
                <SourceLink url={snapshot.representation?.url ?? undefined} />
              </Detail>
              <CapturedClaims claims={snapshot.representation?.claims} />
            </dl>
          </DetailSection>
          <Separator />
          <DetailSection title="Remote preview">
            <dl>
              <Detail label="URL">
                <SourceLink url={snapshot.preview?.url ?? undefined} />
              </Detail>
              <Detail label="Description">
                <CapturedText value={snapshot.preview?.description ?? undefined} />
              </Detail>
              <CapturedClaims claims={snapshot.preview?.claims} />
            </dl>
          </DetailSection>
        </>
      )}
      <Separator />
      <DetailSection title="Local association">
        <dl>
          <Detail label="Captured File">
            {component.record?.basis ? (
              <CopyIdentityButton label="Captured File" value={component.record.basis} />
            ) : (
              "No local File association"
            )}
          </Detail>
          <Detail label="Status">
            {component.applicability?.status === "input"
              ? component.applicability.comparison.status
              : (component.applicability?.status ?? "Not observed")}
          </Detail>
        </dl>
      </DetailSection>
      <Separator />
      <DetailSection title="Source identifiers">
        <dl>
          <Detail label="Post ID">
            {component.postId ? (
              <CopyIdentityButton key={component.postId} label="Post ID" value={component.postId} />
            ) : (
              <CapturedText value={component.postId} />
            )}
          </Detail>
          <Detail label="User ID">
            {author?.userId ? (
              <CopyIdentityButton key={author.userId} label="User ID" value={author.userId} />
            ) : (
              <CapturedText value={author?.userId} />
            )}
          </Detail>
        </dl>
      </DetailSection>
    </div>
  )
}

function CapturedClaims({ claims }: { claims: Wire<"TwitterMediaClaims"> | null | undefined }) {
  return (
    <>
      <Detail label="Width">{claims?.width ?? "Not captured"}</Detail>
      <Detail label="Height">{claims?.height ?? "Not captured"}</Detail>
      <Detail label="Duration (ms)">
        <CapturedText value={claims?.duration_ms ?? undefined} />
      </Detail>
      <Detail label="MIME">
        <CapturedText value={claims?.mime_type ?? undefined} />
      </Detail>
      <Detail label="Bitrate (bps)">
        <CapturedText value={claims?.bitrate_bps ?? undefined} />
      </Detail>
      <Detail label="Quality">
        <CapturedText value={claims?.quality ?? undefined} />
      </Detail>
    </>
  )
}
