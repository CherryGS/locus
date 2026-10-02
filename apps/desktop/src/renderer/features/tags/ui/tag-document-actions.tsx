import { useSyncExternalStore } from "react"
import { CheckIcon, PencilIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Spinner } from "@/shared/ui/spinner"
import type { TagDetails, TagDetailState } from "../model/tag-detail"

export function TagDocumentActions({
  coordinator: c,
  state: s,
}: {
  coordinator: TagDetails
  state: TagDetailState
}) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  const busy = c.unresolved(s)
  return (
    <div role="group" aria-label="Document actions" className="flex shrink-0 items-center gap-1">
      {s.editing ? (
        <>
          <span className="sr-only" role="status">
            {s.draft !== s.baseline ? "Unsaved description" : "Editing description"}
          </span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => c.discard(s)}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!s.editor || busy || !c.editable || !!s.editorError}
            onClick={() => void c.save(s)}
          >
            {s.work && <Spinner />}Save
          </Button>
        </>
      ) : (
        <>
          {s.attempt?.state === "confirmed" && (
            <span
              role="status"
              aria-label="Description saved"
              title="Description saved"
              className="text-muted-foreground"
            >
              <CheckIcon className="size-3.5" />
            </span>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Edit description"
            title="Edit description"
            disabled={!s.document || s.documentPending || !s.editor || !c.editable}
            onClick={() => c.begin(s)}
          >
            <PencilIcon />
          </Button>
        </>
      )}
    </div>
  )
}
