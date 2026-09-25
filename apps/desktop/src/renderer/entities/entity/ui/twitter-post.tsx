import { Fragment, type ReactNode } from "react"
import { ArrowUpRightIcon, RefreshCwIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@/shared/ui/empty"
import { Spinner } from "@/shared/ui/spinner"
import { Separator } from "@/shared/ui/separator"
import { CapturedText, SourceLink, twitterReferenceLabels, type TwitterComponent } from "./twitter-fields"

export function TwitterPost({
  component,
  onReread,
  media,
}: {
  component: TwitterComponent
  onReread?: () => void
  media?: ReactNode
}) {
  if (component.readStatus && !component.record)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            {component.readStatus === "loading" ? "Reading Twitter capture…" : "Twitter capture unavailable"}
          </EmptyTitle>
          <EmptyDescription>
            {component.readStatus === "loading"
              ? "Loading this component’s saved observation."
              : "This component could not be read. See Overview for the cause."}
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {component.readStatus === "loading" ? (
            <Spinner />
          ) : (
            onReread && (
              <Button variant="outline" onClick={onReread}>
                Reread Entity
              </Button>
            )
          )}
        </EmptyContent>
      </Empty>
    )
  const author = component.author
  const authorName =
    author?.displayName ||
    (author?.handle
      ? `@${author.handle}`
      : author?.userId
        ? `Author ${author.userId}`
        : author
          ? "Captured author"
          : "Author not captured")
  return (
    <article aria-label="Twitter post" className="mx-auto flex w-full max-w-3xl min-w-0 flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-lg font-semibold [overflow-wrap:anywhere]">
            {author?.profileUrl ? <SourceLink url={author.profileUrl}>{authorName}</SourceLink> : authorName}
          </h1>
          {author?.handle && (
            <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">@{author.handle}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {component.postUrl && (
            <span className="text-xs text-muted-foreground">
              <SourceLink url={component.postUrl}>
                <span className="inline-flex items-center gap-1">
                  View original post <ArrowUpRightIcon className="size-3.5" />
                </span>
              </SourceLink>
            </span>
          )}
          {onReread && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Reread Twitter capture"
              title="Reread saved capture"
              onClick={onReread}
              disabled={component.readStatus === "loading"}
            >
              {component.readStatus === "loading" ? <Spinner /> : <RefreshCwIcon />}
            </Button>
          )}
        </div>
      </header>
      <p className="text-base leading-7 whitespace-pre-wrap select-text [overflow-wrap:anywhere]">
        {component.text ? (
          <PostText text={component.text} />
        ) : (
          <CapturedText value={component.text} empty="No post text" />
        )}
      </p>
      {media && (
        <section aria-label="Post media" className="min-w-0">
          {media}
        </section>
      )}
      <footer className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {component.publishedAt && <PostTime label="Published" value={component.publishedAt} />}
          {component.capturedAt && <PostTime label="Captured" value={component.capturedAt} />}
          {!component.postUrl && <span>Post ID · {component.postId ?? "Not captured"}</span>}
        </div>
        {!!component.references?.length && (
          <>
            <Separator />
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
              {component.references.map((reference, index) => (
                <span key={index}>
                  {twitterReferenceLabels[reference.kind]} ·{" "}
                  {reference.url ? (
                    <SourceLink url={reference.url}>{reference.postId ?? reference.url}</SourceLink>
                  ) : (
                    <CapturedText value={reference.postId} />
                  )}
                </span>
              ))}
            </div>
          </>
        )}
      </footer>
    </article>
  )
}

function PostTime({ label, value }: { label: string; value: string }) {
  const date = new Date(value)
  return (
    <span className="inline-flex flex-wrap items-baseline gap-1.5">
      <span>{label}</span>
      <time dateTime={value} title={date.toLocaleString(undefined, { timeZoneName: "short" })}>
        {date.toLocaleString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        })}
      </time>
    </span>
  )
}

function PostText({ text }: { text: string }) {
  const parts: ReactNode[] = []
  let cursor = 0
  for (const match of text.matchAll(/https?:\/\/[^\s<>]+/gi)) {
    const value = match[0].replace(/[.,!;]+$/, "")
    try {
      new URL(value)
    } catch {
      continue
    }
    parts.push(
      <Fragment key={match.index}>
        {text.slice(cursor, match.index)}
        <SourceLink url={value}>{value}</SourceLink>
      </Fragment>,
    )
    cursor = match.index + value.length
  }
  parts.push(text.slice(cursor))
  return parts
}
