import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Crepe } from "@milkdown/crepe"
import { uploadConfig } from "@milkdown/kit/plugin/upload"
import { PencilIcon } from "lucide-react"
import "@milkdown/crepe/theme/common/style.css"
import "@milkdown/crepe/theme/frame.css"
import "./tag-document.css"
import { Button } from "@/shared/ui/button"
import { Spinner } from "@/shared/ui/spinner"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent } from "@/shared/ui/empty"
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
      featureConfigs: {
        [Crepe.Feature.Placeholder]: { text: "Write a description…", mode: "doc" },
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
        c.changed()
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
        c.changed()
      }
      disposed = true
      // Each instance owns its host; a late StrictMode destroy cannot touch its successor.
      void created
        .then(() => crepe.destroy())
        .catch(() => {})
        .finally(() => host.remove())
    }
    // Entering edit mode only changes readonly; preserve editor and code-block instances.
    // Saved read replacement and explicit save/discard still adopt their owned content.
  }, [c, s, version])
  useEffect(() => {
    s.editor?.readonly(!s.editing || !c.editable || c.unresolved(s))
  })
  return (
    <section aria-label="Tag document" className="flex min-h-full min-w-0 flex-col gap-2">
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
        <div className="tag-markdown flex min-w-0 flex-1 flex-col" data-editing={s.editing}>
          {!s.editing && !s.document.markdown && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No description yet</EmptyTitle>
                <EmptyDescription>Notes, context, and links for this tag.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!ready || s.documentPending || !c.editable || c.unresolved(s)}
                  onClick={() => c.begin(s)}
                >
                  <PencilIcon data-icon="inline-start" />
                  Write description
                </Button>
              </EmptyContent>
            </Empty>
          )}
          {!ready && !failure && (
            <div className="px-6 py-3">
              <Spinner />
            </div>
          )}
          <div ref={container} hidden={!s.editing && !s.document.markdown} />
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
