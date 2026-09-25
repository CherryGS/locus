import { useEffect, useState } from "react"
import { ExpandIcon, ImageIcon, VideoIcon } from "lucide-react"
import { errorText, type BackendApi, type Wire } from "@/shared/api"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/shared/ui/empty"
import { Skeleton } from "@/shared/ui/skeleton"

export function CivitaiGallery({
  api,
  unit,
  opening,
  revision,
  onOpen,
}: {
  api: BackendApi
  unit: Wire<"CivitaiVersionView">
  opening: boolean
  revision: string
  onOpen: (entity: string) => void
}) {
  const groups = new Map<string, Wire<"CivitaiManagedExample">[]>()
  for (const example of unit.examples) {
    const key = `${example.binding.entity_id}:${example.binding.file_id}`
    groups.set(key, [...(groups.get(key) ?? []), example])
  }
  const examples = [...groups.values()].map((contributors) => ({
    representative:
      contributors.find((example) => example.applicable && example.binding.complete) ??
      contributors.find((example) => example.applicable) ??
      contributors[0],
    contributors,
  }))
  return (
    <section aria-label="Managed Civitai examples" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-medium">Examples</h2>
        {!!examples.length && <span className="text-xs text-muted-foreground">{examples.length} saved</span>}
      </div>
      {!examples.length ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No saved examples for this version</EmptyTitle>
            <EmptyDescription>
              {unit.version.images.length
                ? `${unit.version.images.length} examples are listed by this source but have no saved targets in this read. Switching versions does not download them.`
                : "This saved observation lists no examples."}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 gap-3 @sm:grid-cols-2">
          {examples.map(({ representative: example }, index) => {
            const video = example.binding.media.some((media) => media.kind === "video")
            const usable = example.applicable && example.binding.complete
            return (
              <figure
                key={`${example.binding.entity_id}:${example.binding.file_id}`}
                className="min-w-0 overflow-hidden rounded-xl border"
              >
                {usable ? (
                  <Button
                    variant="ghost"
                    className="h-auto w-full overflow-hidden p-0"
                    aria-label="Inspect managed example"
                    title={`Open ${video ? "video" : "image"} ${index + 1}`}
                    disabled={opening}
                    onClick={() => onOpen(example.binding.entity_id)}
                  >
                    <ManagedThumbnail key={revision} api={api} example={example} />
                  </Button>
                ) : (
                  <div className="flex aspect-[4/3] items-center justify-center p-4 text-sm text-muted-foreground">
                    {example.problem ??
                      (example.binding.complete
                        ? "Example relationship unavailable"
                        : "Example processing is incomplete")}
                  </div>
                )}
                <figcaption className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    {video ? (
                      <VideoIcon className="size-3.5" aria-hidden="true" />
                    ) : (
                      <ImageIcon className="size-3.5" aria-hidden="true" />
                    )}
                    {video ? "Video" : "Image"} {index + 1}
                  </span>
                  {usable ? (
                    <ExpandIcon className="size-3.5" aria-hidden="true" />
                  ) : (
                    <Badge variant="outline">Unavailable</Badge>
                  )}
                </figcaption>
              </figure>
            )
          })}
        </div>
      )}
      {!!examples.length && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Example sources</summary>
          <div className="flex flex-col gap-3 pt-3">
            <p>
              {unit.version.images.length} examples listed by the selected source. Saved relationships can
              also come from other observations.
            </p>
            {examples.map(({ representative: example, contributors }, index) => (
              <div
                key={`${example.binding.entity_id}:${example.binding.file_id}`}
                className="flex flex-col gap-1 [overflow-wrap:anywhere]"
              >
                <p className="text-foreground">
                  Example {index + 1} · Entity {example.binding.entity_id}
                </p>
                <p>File {example.binding.file_id}</p>
                {contributors.map((contributor, contributorIndex) => (
                  <p
                    key={`${contributor.source.component_id}:${contributor.binding.occurrence}:${contributorIndex}`}
                  >
                    From {contributor.source.entity_id} · occurrence {contributor.binding.occurrence + 1} ·{" "}
                    {contributor.binding.content_type} ·{" "}
                    {contributor.applicable ? "applicable" : (contributor.problem ?? "unavailable")}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </details>
      )}
    </section>
  )
}

function ManagedThumbnail({ api, example }: { api: BackendApi; example: Wire<"CivitaiManagedExample"> }) {
  const [url, setUrl] = useState<string>()
  const [problem, setProblem] = useState<string>()
  useEffect(() => {
    const controller = new AbortController()
    let objectUrl: string | undefined
    let current = true
    void (async () => {
      const result = await api.memberships([example.binding.entity_id])
      const member = result.find((entry) => entry.entity_id === example.binding.entity_id)
      if (
        !member ||
        member.status !== "present" ||
        !member.memberships.some(
          (membership) =>
            membership.kind_id === "9fd73d3d-d35d-41bc-8b73-402e12f5c017" &&
            membership.component_id === example.binding.file_id,
        )
      )
        throw new Error("Example current File no longer matches its relationship")
      const target = example.binding.media.find((media) => media.kind === "image") ?? example.binding.media[0]
      if (!target) throw new Error("No completed Media component")
      const preview = await api.savedPreview(target.kind, target.component_id)
      if (!preview || preview.file_id !== example.binding.file_id)
        throw new Error("The already-produced preview is unavailable; rereading does not generate it")
      const bytes = await api.previewBytes(preview.locator, controller.signal)
      objectUrl = URL.createObjectURL(bytes)
      if (current) setUrl(objectUrl)
    })().catch((error) => {
      if (current) setProblem(errorText(error))
    })
    return () => {
      current = false
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [api, example.binding.entity_id, example.binding.file_id])
  return problem ? (
    <span className="flex aspect-[4/3] w-full items-center justify-center whitespace-normal p-4 text-sm">
      {problem}
    </span>
  ) : url ? (
    <img
      src={url}
      alt="Managed Civitai example"
      className="aspect-[4/3] w-full object-contain"
      onError={() =>
        setProblem("Managed image could not be displayed. Reread the selected version to retry.")
      }
    />
  ) : (
    <Skeleton className="aspect-[4/3] w-full" />
  )
}
