import type { ReactNode } from "react"
import { Button } from "@/shared/ui/button"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from "@/shared/ui/empty"
import { Skeleton } from "@/shared/ui/skeleton"
import { Badge } from "@/shared/ui/badge"
import { Separator } from "@/shared/ui/separator"
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/shared/ui/card"
import type { BilibiliComponent } from "../model/bilibili-projection"
import { SourceLink, CapturedText } from "./twitter-fields"

export function BilibiliReading({
  component,
  player,
  playbackPending,
  onReread,
  onRetryCover,
}: {
  component: BilibiliComponent
  player?: ReactNode
  playbackPending?: boolean
  onReread?: () => void
  onRetryCover?: () => void
}) {
  const s = component.record?.snapshot
  if (!s)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            {component.readStatus === "loading"
              ? "Reading Bilibili capture…"
              : "Bilibili capture unavailable"}
          </EmptyTitle>
          <EmptyDescription>Read the saved Source observation through this Entity.</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          {component.readStatus === "loading" ? (
            <Skeleton className="h-5 w-48" />
          ) : (
            <Button variant="outline" onClick={onReread}>Reread Entity</Button>
          )}
        </EmptyContent>
      </Empty>
    )
  const link = s.page_url ?? (s.bvid
    ? "https://www.bilibili.com/video/" + s.bvid
    : s.aid ? "https://www.bilibili.com/video/av" + s.aid : undefined)
  const cover = component.cover
  const original = <OriginalCover component={component} onRetry={onRetryCover} />
  return (
    <article className="mx-auto flex w-full max-w-5xl flex-col gap-5" aria-label="Bilibili capture">
      <header className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold leading-snug tracking-tight">
          <CapturedText value={s.title ?? undefined} empty="Untitled submission" />
        </h2>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-muted-foreground">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {s.author?.profile_url ? (
              <SourceLink url={s.author.profile_url}>
                {s.author.display_name ?? s.author.user_id ?? "Captured author"}
              </SourceLink>
            ) : (
              <span>{s.author?.display_name ?? (s.author?.user_id ? "Author " + s.author.user_id : "Author not captured")}</span>
            )}
            {s.published_at_unix_ms != null && (
              <>
                <span aria-hidden="true">·</span>
                <span title={capturedTime(s.published_at_unix_ms)}>
                  {new Date(Number(s.published_at_unix_ms)).toLocaleDateString()}
                </span>
              </>
            )}
          </div>
          <SourceLink url={link}>View original submission</SourceLink>
        </div>
      </header>
      <section aria-label="Playback and selected part" className="overflow-hidden rounded-xl border">
      {player ?? (
        <div className="flex flex-col gap-3 p-4">
          {original}
          <p role="status" className="text-sm text-muted-foreground">
            {playbackPending ? "Reading local video…" : "Local video unavailable. See Overview for the current file and association details."}
          </p>
        </div>
      )}
      {player && !cover?.thumbnail && (
        <section aria-label="Saved original cover" className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
          <span>{cover?.state === "loading" ? "Loading original cover…" : "Original cover unavailable"}</span>
          {cover?.state !== "loading" && <span>{cover?.message ?? "No usable original cover is available."}</span>}
          {cover?.resourceFailed && <Button variant="outline" size="sm" onClick={onRetryCover}>Retry original-cover display</Button>}
        </section>
      )}
        {s.part && (
          <>
            <Separator />
            <section aria-label="Selected part" className="flex items-start gap-3 bg-card px-4 py-3">
              <Badge variant="secondary">{s.part.number == null ? "Selected part" : "Part " + s.part.number}</Badge>
              <p className="min-w-0 text-sm"><CapturedText value={s.part.title ?? undefined} empty="Untitled part" /></p>
            </section>
          </>
        )}
      </section>
      <Card role="region" aria-label="Submission description" className="@container">
        <CardHeader><CardTitle><h3>Description</h3></CardTitle></CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm leading-6"><CapturedText value={s.description ?? undefined} empty="No description" /></p>
          {!!s.tags?.length && (
            <div className="flex flex-wrap gap-2">
              {s.tags.map((tag, i) => <Badge key={i} variant="secondary">{tag}</Badge>)}
            </div>
          )}
        </CardContent>
        <CardFooter>
          <details className="w-full">
            <summary className="cursor-pointer text-sm text-muted-foreground">Captured details</summary>
            <div className="flex flex-col gap-5 pt-5">
              <div className="grid gap-6 @2xl:grid-cols-2">
                <section className="flex flex-col gap-3">
                  <h4 className="text-sm font-medium">Source information</h4>
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
                    <dt className="text-muted-foreground">Submission</dt><dd>{s.bvid ?? (s.aid ? "AV" + s.aid : "Not captured")}</dd>
                    <dt className="text-muted-foreground">Published</dt><dd>{capturedTime(s.published_at_unix_ms)}</dd>
                    <dt className="text-muted-foreground">Captured</dt><dd>{capturedTime(s.observed_at_unix_ms)}</dd>
                    <dt className="text-muted-foreground">Part order</dt><dd>{s.part?.number ?? "Not captured"}</dd>
                    <dt className="text-muted-foreground">CID</dt><dd className="break-all">{s.part?.cid ?? "Not captured"}</dd>
                    <dt className="text-muted-foreground">Tags</dt>
                    <dd>{s.tags == null ? "Not captured" : s.tags.length ? s.tags.join(", ") : "No tags captured"}</dd>
                  </dl>
                </section>
                <section className="flex flex-col gap-3">
                  <h4 className="text-sm font-medium">Captured media</h4>
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-xs">
                    <dt className="text-muted-foreground">Quality</dt><dd>{s.representation?.claims?.quality ?? "Not captured"}</dd>
                    <dt className="text-muted-foreground">Format</dt><dd>{s.representation?.claims?.mime_type ?? "Not captured"}</dd>
                    <dt className="text-muted-foreground">Dimensions</dt>
                    <dd>{s.representation?.claims?.width && s.representation.claims.height
                      ? s.representation.claims.width + " × " + s.representation.claims.height : "Not captured"}</dd>
                    <dt className="text-muted-foreground">Duration</dt><dd>{s.representation?.claims?.duration_ms ? s.representation.claims.duration_ms + " ms" : "Not captured"}</dd>
                    <dt className="text-muted-foreground">Source file</dt>
                    <dd><SourceLink url={s.representation?.url ?? undefined}>Supplied representation link</SourceLink></dd>
                  </dl>
                  <p className="text-xs text-muted-foreground">Source claims, independent of local video properties.</p>
                </section>
              </div>
              {player && cover?.thumbnail && (
                <div className="flex flex-col gap-3">
                  <h4 className="text-sm font-medium">Original cover</h4>
                  {original}
                </div>
              )}
            </div>
          </details>
        </CardFooter>
      </Card>
    </article>
  )
}

function OriginalCover({ component, onRetry }: { component: BilibiliComponent; onRetry?: () => void }) {
  const cover = component.cover
  return (
    <section aria-label="Saved original cover" className="flex flex-col gap-2">
      {cover?.thumbnail ? (
        <img src={cover.thumbnail} alt="Saved Bilibili original cover" className="max-h-80 w-full rounded-lg object-contain" />
      ) : cover?.state === "loading" ? (
        <Skeleton className="aspect-video w-full" />
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Original cover unavailable</EmptyTitle>
            <EmptyDescription>{cover?.message ?? (cover?.state === "absent"
              ? "No local original cover is associated with this capture."
              : "The saved original cover could not be displayed.")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
      {cover?.resourceFailed && <Button variant="outline" onClick={onRetry}>Retry original-cover display</Button>}
    </section>
  )
}
function capturedTime(value: string | null | undefined) {
  return value == null ? "Not captured" : new Date(Number(value)).toLocaleString(undefined, { timeZoneName: "short" })
}
