import { Button } from "@/shared/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/shared/ui/card"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from "@/shared/ui/empty"
import { Skeleton } from "@/shared/ui/skeleton"
import { Badge } from "@/shared/ui/badge"
import type { BilibiliComponent } from "../model/bilibili-projection"
import { SourceLink, CapturedText } from "./twitter-fields"

export function BilibiliReading({
  component,
  onReread,
  onRetryCover,
}: {
  component: BilibiliComponent
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
            <Button variant="outline" onClick={onReread}>
              Reread Entity
            </Button>
          )}
        </EmptyContent>
      </Empty>
    )
  const link =
    s.page_url ??
    (s.bvid
      ? "https://www.bilibili.com/video/" + s.bvid
      : s.aid
        ? "https://www.bilibili.com/video/av" + s.aid
        : undefined)
  const cover = component.cover
  return (
    <Card className="mx-auto w-full max-w-3xl" role="article" aria-label="Bilibili capture">
      <CardHeader>
        <CardDescription className="flex items-center gap-2">
          <Badge variant="secondary">Bilibili</Badge>Saved capture
        </CardDescription>
        <CardTitle>
          <CapturedText value={s.title ?? undefined} empty="Untitled submission" />
        </CardTitle>
        <CardDescription>
          {s.author?.profile_url ? (
            <SourceLink url={s.author.profile_url}>
              {s.author.display_name ?? s.author.user_id ?? "Captured author"}
            </SourceLink>
          ) : (
            (s.author?.display_name ??
            (s.author?.user_id
              ? "Author " + s.author.user_id
              : s.author
                ? "Captured author"
                : "Author not captured"))
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <section aria-label="Saved original cover" className="flex flex-col gap-2">
          {cover?.thumbnail ? (
            <img
              src={cover.thumbnail}
              alt="Saved Bilibili original cover"
              className="max-h-96 w-full object-contain"
            />
          ) : cover?.state === "loading" ? (
            <Skeleton className="aspect-video w-full" />
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>Original cover unavailable</EmptyTitle>
                <EmptyDescription>
                  {cover?.message ??
                    (cover?.state === "absent"
                      ? "No local original cover is associated with this capture."
                      : "The saved original cover could not be displayed.")}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          {cover?.resourceFailed && (
            <Button variant="outline" onClick={onRetryCover}>
              Retry original-cover display
            </Button>
          )}
        </section>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Submission</h3>
          <p className="text-sm leading-6">
            <CapturedText value={s.description ?? undefined} empty="No description" />
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Selected part</h3>
          {s.part ? (
            <>
              <p className="text-sm">
                <CapturedText value={s.part.title ?? undefined} empty="Untitled part" />
              </p>
              <p className="text-xs text-muted-foreground">
                {s.part.number == null ? "Part order not captured" : "Part " + s.part.number}
                {s.part.cid ? " · CID " + s.part.cid : " · CID not captured"}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Part context not captured</p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Captured context</h3>
          <p className="text-xs text-muted-foreground">
            Published: {capturedTime(s.published_at_unix_ms)} · Observed:{" "}
            {capturedTime(s.observed_at_unix_ms)}
          </p>
          <p className="text-sm">
            Selected representation:{" "}
            {s.representation?.url ? (
              <SourceLink url={s.representation.url}>Supplied representation link</SourceLink>
            ) : (
              "URL not captured"
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {s.representation?.claims?.quality ?? "Quality not captured"} ·{" "}
            {s.representation?.claims?.mime_type ?? "MIME type not captured"}
            {s.representation?.claims?.width && s.representation.claims.height
              ? " · " + s.representation.claims.width + " × " + s.representation.claims.height
              : ""}
            {s.representation?.claims?.duration_ms
              ? " · " + s.representation.claims.duration_ms + " ms (Source claim)"
              : ""}
          </p>
        </div>
        {s.tags && (
          <div className="flex flex-wrap gap-2">
            {s.tags.length ? (
              s.tags.map((tag, i) => (
                <Badge key={i} variant="outline">
                  {tag}
                </Badge>
              ))
            ) : (
              <p className="text-xs text-muted-foreground">No tags captured</p>
            )}
          </div>
        )}
      </CardContent>
      <CardFooter className="flex-col items-start gap-2">
        <SourceLink url={link}>View original submission</SourceLink>
        <p className="text-xs text-muted-foreground">
          {s.bvid ?? (s.aid ? "AV" + s.aid : "Submission URL")} · Captured information; local playback is
          available separately in Video.
        </p>
      </CardFooter>
    </Card>
  )
}

function capturedTime(value: string | null | undefined) {
  return value == null
    ? "Not captured"
    : new Date(Number(value)).toLocaleString(undefined, { timeZoneName: "short" })
}
