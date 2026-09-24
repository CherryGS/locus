import type { EntityComponent } from "../model/entity-item"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/shared/ui/card"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from "@/shared/ui/empty"
import { Spinner } from "@/shared/ui/spinner"
import { CapturedText, SourceLink } from "./source-fields"

export type BilibiliComponent = Extract<EntityComponent, { kind: "bilibili" }>

export function BilibiliPost({
  component,
  onReread,
}: {
  component: BilibiliComponent
  onReread?: () => void
}) {
  const snapshot = component.record?.snapshot
  if (!snapshot)
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>
            {component.readStatus === "loading"
              ? "Reading Bilibili capture…"
              : "Bilibili capture unavailable"}
          </EmptyTitle>
          <EmptyDescription>
            {component.readStatus === "loading"
              ? "Loading the saved video source information."
              : "See Overview for the read problem."}
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
  const part = snapshot.part
  return (
    <Card className="mx-auto w-full max-w-2xl" role="article" aria-label="Bilibili video source">
      <CardHeader>
        <CardDescription>Saved Bilibili capture</CardDescription>
        <CardTitle>
          <CapturedText value={snapshot.title ?? undefined} empty="Untitled submission" />
        </CardTitle>
        <CardDescription>
          Uploader · <CapturedText value={snapshot.uploader?.display_name ?? undefined} />
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{part?.index ? `P${part.index}` : "Part not captured"}</Badge>
          <Badge variant="outline">
            {snapshot.asset_role === "cover"
              ? "Submission cover"
              : snapshot.asset_role === "video"
                ? "Selected video"
                : "Asset role not captured"}
          </Badge>
          {part?.title && (
            <span>
              <CapturedText value={part.title} />
            </span>
          )}
        </div>
        <p className="leading-7 select-text">
          <CapturedText value={snapshot.description ?? undefined} empty="No description" />
        </p>
        {component.previous && (
          <p role="status" className="text-sm text-muted-foreground">
            Showing the previous saved observation. See Overview for the latest read problem.
          </p>
        )}
      </CardContent>
      <CardFooter className="flex-col items-start gap-3">
        <SourceLink url={snapshot.page_url ?? undefined}>Open selected part</SourceLink>
        <p className="text-xs text-muted-foreground">
          {snapshot.bvid ?? (snapshot.aid ? `av${snapshot.aid}` : "Video ID not captured")} · CID{" "}
          {part?.cid ?? "not captured"}
        </p>
      </CardFooter>
    </Card>
  )
}
