import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/shared/ui/card"
import { CapturedText, SourceLink, twitterReferenceLabels, type TwitterComponent } from "./twitter-fields"

export function TwitterPost({ component }: { component: TwitterComponent }) {
  const author = component.author
  const authorName = author?.displayName || (author?.handle ? `@${author.handle}` : "Author not captured")
  return (
    <Card className="mx-auto w-full max-w-2xl" role="article" aria-label="Twitter post">
      <CardHeader>
        <CardTitle>{author?.profileUrl ? <SourceLink url={author.profileUrl}>{authorName}</SourceLink> : authorName}</CardTitle>
        <CardDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {author?.handle && <span>@{author.handle}</span>}
          {component.publishedAt && <time dateTime={component.publishedAt} title={new Date(component.publishedAt).toLocaleString(undefined, { timeZoneName: "short" })}>
            {new Date(component.publishedAt).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}
          </time>}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <p className="leading-7 select-text"><CapturedText value={component.text} empty="No post text" /></p>
      </CardContent>
      <CardFooter className="flex-col items-start gap-3">
        {component.postUrl ? <SourceLink url={component.postUrl}>View original post</SourceLink>
          : <span className="text-xs text-muted-foreground">Post ID · {component.postId ?? "Not captured"}</span>}
        {component.references?.map((reference, index) => (
          <p key={index} className="text-xs text-muted-foreground">
            {twitterReferenceLabels[reference.kind]} · {reference.url
              ? <SourceLink url={reference.url}>{reference.postId ?? reference.url}</SourceLink>
              : <CapturedText value={reference.postId} />}
          </p>
        ))}
      </CardFooter>
    </Card>
  )
}
