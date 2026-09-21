import { useEffect, useState } from "react"
import type { BackendApi } from "@/shared/api"
import { errorText } from "@/shared/api"
import type { EntityReader } from "@/entities/entity"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/shared/ui/empty"
import { Button } from "@/shared/ui/button"
import { Spinner } from "@/shared/ui/spinner"
import { ImageInspection } from "./image-inspection"

export function LiveImage({
  api,
  reader,
  entityId,
  componentId,
  fileId,
  name,
  loading,
}: {
  api: BackendApi
  reader: EntityReader
  entityId: string
  componentId: string
  fileId?: string
  name: string
  loading: boolean
}) {
  const generation = reader.resourceRevision(entityId)
  const basis = `${componentId}:${fileId}`
  const [resource, setResource] = useState<{ basis: string; generation: number; src?: string; error?: string }>()
  useEffect(() => {
    if (!fileId) return
    const controller = new AbortController()
    let current = true
    let url: string | undefined
    void api.bytes(fileId, controller.signal).then(
      (blob) => {
        if (!current) return
        url = URL.createObjectURL(blob)
        setResource({ basis, generation, src: url })
      },
      (error: unknown) => {
        if (!current) return
        const message = errorText(error)
        reader.resourceResult(entityId, basis, generation, message)
        setResource({ basis, generation, error: message })
      }
    )
    return () => {
      current = false
      controller.abort()
      if (url) URL.revokeObjectURL(url)
    }
  }, [api, reader, entityId, basis, generation])
  const current = resource?.basis === basis && resource.generation === generation ? resource : undefined
  if (!fileId || current?.error)
    return (
      <Empty className="h-full">
        <EmptyHeader>
          {loading && <Spinner />}
          <EmptyTitle>{loading ? "Reading Image input…" : "Image input unavailable"}</EmptyTitle>
          <EmptyDescription>
            {current?.error
              ? "The current File bytes could not be opened. See Overview for details."
              : "The Image owner has not supplied an available current File input. See Overview for the observation and recovery."}
          </EmptyDescription>
        </EmptyHeader>
        {fileId && (
          <Button variant="outline" onClick={() => reader.retryResource(entityId)}>
            Retry image
          </Button>
        )}
      </Empty>
    )
  if (!current?.src)
    return (
      <Empty className="h-full">
        <EmptyHeader>
          <Spinner />
          <EmptyDescription>Reading current File bytes…</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  return (
    <>
      <p className="px-4 py-2 text-xs text-muted-foreground">Current File bytes · {fileId}</p>
      <ImageInspection
        key={`${basis}:${generation}`}
        src={current.src}
        name={name}
        onDecoded={() => reader.resourceResult(entityId, basis, generation)}
        onFailed={() =>
          reader.resourceResult(entityId, basis, generation, "The current File bytes could not be decoded as an image.")
        }
        onRetry={() => reader.retryResource(entityId)}
      />
    </>
  )
}
