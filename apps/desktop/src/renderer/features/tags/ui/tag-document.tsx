import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Crepe } from "@milkdown/crepe"
import { uploadConfig } from "@milkdown/kit/plugin/upload"
import "@milkdown/crepe/theme/common/style.css"
import "@milkdown/crepe/theme/frame.css"
import "./tag-document.css"
import { PencilIcon, RefreshCwIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Spinner } from "@/shared/ui/spinner"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/shared/ui/empty"
import type { TagDetails, TagDetailState } from "../model/tag-detail"
import { errorText } from "@/shared/api"

export function TagDocument({
  coordinator: c,
  state: s,
}: {
  coordinator: TagDetails
  state: TagDetailState
}) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  const container = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [failure, setFailure] = useState<string>()
  const version = s.editorVersion
  const content = s.editing ? s.draft : s.document?.markdown
  const persistedRevision = s.document?.tag.revision
  useEffect(() => {
    const element = container.current
    if (!element || content === undefined) return
    let disposed = false
    const host = document.createElement("div")
    element.append(host)
    setReady(false)
    setFailure(undefined)
    const crepe = new Crepe({
      root: host,
      defaultValue: content,
      features: {
        [Crepe.Feature.ImageBlock]: false,
        [Crepe.Feature.Latex]: false,
        [Crepe.Feature.TopBar]: false,
        [Crepe.Feature.AI]: false,
      },
    })
    crepe.editor.config((ctx) =>
      ctx.update(uploadConfig.key, (previous) => ({ ...previous, uploader: async () => [] })),
    )
    crepe.setReadonly(!s.editing || !c.editable || c.unresolved(s))
    crepe.on((listener) =>
      listener.markdownUpdated((_ctx, markdown) => {
        if (!disposed && s.editing) c.update(s, markdown)
      }),
    )
    const adapter = {
      read: () => crepe.getMarkdown(),
      readonly: (value: boolean) => crepe.setReadonly(value),
    }
    const created = crepe
      .create()
      .then(() => {
        if (disposed) return
        s.editor = adapter
        c.mounted(s, crepe.getMarkdown())
        setReady(true)
      })
      .catch((error) => {
        if (!disposed) {
          const message = errorText(error)
          s.editorError = message
          setFailure(message)
          c.changed()
        }
      })
    return () => {
      if (s.editor === adapter) {
        c.capture(s)
        s.editor = undefined
      }
      disposed = true
      // Each instance owns its host; a late StrictMode destroy cannot touch its successor.
      void created
        .then(() => crepe.destroy())
        .catch(() => {})
        .finally(() => host.remove())
    }
    // Typing is imperative; remount only on deliberate edit/save/discard or saved read replacement.
  }, [c, s, version, s.editing ? undefined : persistedRevision])
  useEffect(() => {
    s.editor?.readonly(!s.editing || !c.editable || c.unresolved(s))
  })
  const busy = c.unresolved(s)
  return (
    <section aria-label="Tag document" className="flex h-full min-h-0 flex-col">
      <div className="flex h-11 shrink-0 items-center gap-2 px-4">
        <p className="flex-1 text-sm text-muted-foreground">Description</p>
        {s.attempt?.state === "confirmed" && (
          <span role="status" className="text-xs text-muted-foreground">
            {s.attempt.message}
          </span>
        )}
        {s.editing ? (
          <>
            <span className="text-xs text-muted-foreground">
              {s.draft !== s.baseline ? "Unsaved" : "Editing"}
            </span>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => c.discard(s)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!ready || busy || !c.editable || !!s.editorError}
              onClick={() => void c.save(s)}
            >
              {s.work && <Spinner />}Save
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            disabled={!s.document || s.documentPending || !ready || !c.editable}
            onClick={() => c.begin(s)}
          >
            <PencilIcon data-icon="inline-start" />
            Edit description
          </Button>
        )}
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Reload tag document"
          disabled={s.documentPending || busy || s.editing}
          onClick={() => void c.read(s)}
        >
          {s.documentPending ? <Spinner /> : <RefreshCwIcon />}
        </Button>
      </div>
      {(s.documentError || failure) && (
        <Alert variant="destructive">
          <AlertDescription>
            {s.documentError ?? failure}
            {s.documentError && s.document && " Showing the previously read document."}
          </AlertDescription>
        </Alert>
      )}
      {s.attempt && s.attempt.state !== "confirmed" && (
        <Alert variant={s.attempt.state === "failed" ? "destructive" : "default"}>
          <AlertDescription className="flex items-center gap-2">
            <span className="flex-1">{s.attempt.message}</span>
            {s.attempt.state === "unconfirmed" && (
              <Button
                size="sm"
                variant="outline"
                disabled={s.attempt.recovering || !!s.work}
                onClick={() => void c.recover(s)}
              >
                Recover original request
              </Button>
            )}
            {s.attempt.state === "failed" && (
              <Button
                size="sm"
                variant="outline"
                disabled={s.documentPending}
                onClick={() => void c.read(s, true)}
              >
                Use latest observation
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {s.document ? (
        <div className="tag-markdown min-h-0 flex-1 overflow-auto" data-editing={s.editing}>
          {!s.editing && !s.document.markdown && (
            <p className="px-6 pt-4 text-sm text-muted-foreground">
              Add a description to this tag.
            </p>
          )}
          {!ready && !failure && (
            <div className="px-6 py-3">
              <Spinner />
            </div>
          )}
          <div ref={container} />
        </div>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>
              {s.documentPending ? "Reading document…" : "Document unavailable"}
            </EmptyTitle>
            <EmptyDescription>
              {s.documentError ?? "Retry to read this Tag's document."}
            </EmptyDescription>
          </EmptyHeader>
          {!s.documentPending && (
            <Button variant="outline" onClick={() => void c.read(s)}>
              Retry document
            </Button>
          )}
        </Empty>
      )}
    </section>
  )
}
