import { Separator } from "@/shared/ui/separator"
import { CopyIdentityButton } from "@/shared/ui/copy-identity-button"
import { Detail, DetailSection, DetailTime } from "./detail-fields"
import { CapturedText, SourceLink, twitterReferenceLabels, type TwitterComponent } from "./twitter-fields"

export function TwitterDetails({ component }: { component: TwitterComponent }) {
  const author = component.author
  return (
    <div className="flex min-w-0 flex-col pb-1">
      <DetailSection title="Post">
        <dl>
          <Detail label="Post ID">{component.postId ? <CopyIdentityButton key={component.postId} label="Post ID" value={component.postId} /> : <CapturedText value={component.postId} />}</Detail>
          <Detail label="Original"><SourceLink url={component.postUrl}>Open post</SourceLink></Detail>
        </dl>
        <p className="text-xs leading-5 select-text"><CapturedText value={component.text} empty="No post text" /></p>
      </DetailSection>
      <Separator />
      <DetailSection title="Author">
        <dl>
          <Detail label="Name"><CapturedText value={author?.displayName} /></Detail>
          <Detail label="Username"><CapturedText value={author?.handle ? `@${author.handle}` : author?.handle} /></Detail>
          <Detail label="User ID">{author?.userId ? <CopyIdentityButton key={author.userId} label="User ID" value={author.userId} /> : <CapturedText value={author?.userId} />}</Detail>
          <Detail label="Profile"><SourceLink url={author?.profileUrl}>Open profile</SourceLink></Detail>
        </dl>
      </DetailSection>
      <Separator />
      <DetailSection title="Dates">
        <dl>
          <Detail label="Published">{component.publishedAt ? <DetailTime value={component.publishedAt} /> : <CapturedText value={undefined} />}</Detail>
          <Detail label="Captured">{component.capturedAt ? <DetailTime value={component.capturedAt} /> : <CapturedText value={undefined} />}</Detail>
        </dl>
      </DetailSection>
      <Separator />
      <DetailSection title="Current media">
        <dl>
          <Detail label="Position">{component.sourceOrder === undefined ? <CapturedText value={undefined} /> : `#${component.sourceOrder + 1}`}</Detail>
          <Detail label="ALT"><CapturedText value={component.altText} /></Detail>
        </dl>
      </DetailSection>
      <Separator />
      <DetailSection title="References">
        {component.references === undefined ? <p className="text-xs text-muted-foreground">Not captured</p>
          : component.references.length === 0 ? <p className="text-xs text-muted-foreground">None</p>
          : <dl>{component.references.map((reference, index) => (
            <Detail key={index} label={twitterReferenceLabels[reference.kind]}>
              {reference.url ? <SourceLink url={reference.url}>Open post</SourceLink> : <CapturedText value={reference.postId} />}
            </Detail>
          ))}</dl>}
      </DetailSection>
    </div>
  )
}
