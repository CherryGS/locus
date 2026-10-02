import type { ReactNode } from "react"
import { useSyncExternalStore } from "react"
import { TagsIcon } from "lucide-react"
import {
  TagVocabulary,
  type TagCoordinator,
  type TagBrowsing,
} from "@/features/tags"
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/shared/ui/empty"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Button } from "@/shared/ui/button"
import { Spinner } from "@/shared/ui/spinner"

export function TagsPage({
  tags,
  browsing,
  tagId,
  inspecting,
  onSelect,
  content,
}: {
  tags: TagCoordinator
  browsing: TagBrowsing
  tagId?: string
  inspecting: boolean
  onSelect: (id: string) => void
  content: ReactNode
}) {
  useSyncExternalStore(browsing.subscribe, browsing.snapshot)
  const current = browsing.tagId === tagId
  const missing = current && browsing.missing
  const pending = !!tagId && (!current || browsing.pending)
  return (
    <section aria-label="Tags" className="flex h-full min-h-0 min-w-0 max-md:flex-col">
      <TagVocabulary
        coordinator={tags}
        selectedId={missing ? undefined : tagId}
        onSelect={onSelect}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {current && browsing.stale && (
          <Alert>
            <AlertDescription>
              Tag assignments changed. This is the previous complete result.
              <Button
                size="sm"
                variant="outline"
                disabled={browsing.pending}
                onClick={() => void browsing.refresh()}
              >
                Refresh tag content
              </Button>
            </AlertDescription>
          </Alert>
        )}
        {current && browsing.error && browsing.sequence && (
          <Alert variant="destructive">
            <AlertDescription>
              Tag content refresh failed: {browsing.error}. Showing the previous
              result.
            </AlertDescription>
          </Alert>
        )}
        {!tagId ||
        (!inspecting && (missing || !current || !browsing.sequence)) ? (
          <Empty className="h-full">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                {pending ? <Spinner /> : <TagsIcon />}
              </EmptyMedia>
              <EmptyTitle>
                {missing
                  ? "Tag unavailable"
                  : !tagId
                    ? "Choose a tag"
                    : pending
                      ? "Finding tagged content…"
                      : "Unable to load tag content"}
              </EmptyTitle>
              <EmptyDescription>
                {missing
                  ? "This tag no longer exists. Choose another tag to continue browsing."
                  : !tagId
                    ? "Browse your tagged images, videos and model files. Choose a tag from the list, or create your first one."
                    : pending
                      ? "Reading the complete result for this tag."
                      : (browsing.error ??
                        "No result is loaded. Retry to browse this tag.")}
              </EmptyDescription>
            </EmptyHeader>
            {tagId && !missing && !pending && (
              <Button onClick={() => void browsing.refresh()}>
                Retry tag content
              </Button>
            )}
          </Empty>
        ) : (
          content
        )}
      </div>
    </section>
  )
}
