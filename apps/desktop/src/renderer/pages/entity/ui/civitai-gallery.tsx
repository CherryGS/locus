import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react"
import type { CardCoverCoordinator } from "@/features/entity-card-cover"
import { ChevronLeftIcon, ChevronRightIcon, ExpandIcon, ImageIcon, InfoIcon, StarIcon, VideoIcon } from "lucide-react"
import { errorText, type BackendApi, type Wire } from "@/shared/api"
import { Button } from "@/shared/ui/button"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/shared/ui/empty"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { Skeleton } from "@/shared/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog"

type Preview = { url?: string; problem?: string }
const exampleKey = (example: Wire<"CivitaiManagedExample">) =>
  `${example.binding.entity_id}:${example.binding.file_id}`

export function CivitaiGallery({
  api,
  covers,
  originEntity,
  unit,
  opening,
  revision,
  onOpen,
}: {
  api: BackendApi
  covers?: CardCoverCoordinator
  originEntity?: string
  unit: Wire<"CivitaiVersionView">
  opening: boolean
  revision: string
  onOpen: (entity: string) => void
}) {
  useSyncExternalStore(covers?.subscribe ?? noSubscribe, covers?.snapshot ?? zero)
  const coverState = originEntity && covers ? covers.get(originEntity) : undefined
  const savedCover = coverState?.observed?.status === "saved" ? coverState.observed.cover : null
  const isCover = (example: Wire<"CivitaiManagedExample">) => !!savedCover && savedCover.version_id === unit.version.id && savedCover.target_entity_id === example.binding.entity_id && savedCover.target_file_id === example.binding.file_id && example.binding.media.some(media => media.kind === "image" && media.component_id === savedCover.image_component_id)
  const groups = new Map<string, Wire<"CivitaiManagedExample">[]>()
  for (const example of unit.examples) {
    const key = exampleKey(example)
    groups.set(key, [...(groups.get(key) ?? []), example])
  }
  const examples = [...groups.values()].map((contributors) => ({
    representative:
      contributors.find((example) => example.applicable && example.binding.complete) ??
      contributors.find((example) => example.applicable) ??
      contributors[0],
    contributors,
  }))
  const outsideCover = savedCover && !examples.some(({ representative }) => isCover(representative))
  const [selected, setSelected] = useState<string>()
  const [previews, setPreviews] = useState<Record<string, Preview | undefined>>({})
  const strip = useRef<HTMLDivElement>(null)
  const count = useRef<HTMLSpanElement>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const index = Math.max(
    0,
    examples.findIndex(({ representative }) => exampleKey(representative) === selected),
  )
  const active = examples[index]?.representative
  const activeKey = active && exampleKey(active)
  const usable = !!active?.applicable && active.binding.complete
  const preview = activeKey ? previews[activeKey] : undefined
  const video = active?.binding.media.some((media) => media.kind === "video")
  const reportPreview = useCallback((key: string, value: Preview | undefined) => {
    setPreviews((previous) => ({ ...previous, [key]: value }))
  }, [])
  function move(offset: number) {
    const next = examples[index + offset]
    if (!opening && next) setSelected(exampleKey(next.representative))
  }
  useEffect(() => {
    const viewport = strip.current
    const button = activeKey && buttons.current.get(activeKey)
    if (!viewport || !button) return
    const view = viewport.getBoundingClientRect(),
      item = button.getBoundingClientRect()
    if (item.left < view.left) viewport.scrollLeft -= view.left - item.left
    else if (item.right > view.right) viewport.scrollLeft += item.right - view.right
  }, [activeKey])
  return (
    <section
      aria-label="Managed Civitai examples"
      className="flex min-w-0 flex-col gap-3"
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).closest('[data-slot="dialog-content"]')) return
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
        event.stopPropagation()
        if ((event.target as HTMLElement).closest('[data-slot="toggle-group"]')) return
        event.preventDefault()
        move(event.key === "ArrowLeft" ? -1 : 1)
      }}
    >
      <h2 className="sr-only">Examples</h2>
      <div
        className="relative flex h-80 items-center justify-center overflow-hidden rounded-xl border"
        data-slot="civitai-gallery-stage"
      >
        {!active ? (
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
        ) : usable ? (
          <Button
            variant="ghost"
            className="relative size-full overflow-hidden p-0"
            aria-label="Inspect managed example"
            title={`Open ${video ? "video" : "image"} ${index + 1}`}
            aria-disabled={opening}
            onClick={() => {
              if (!opening) onOpen(active.binding.entity_id)
            }}
          >
            {preview?.url ? (
              <img
                src={preview.url}
                alt={`Civitai example ${index + 1}`}
                className="size-full object-contain"
                onError={() =>
                  reportPreview(activeKey!, {
                    problem: "Preview unavailable. Open the example to inspect it or reread this version.",
                  })
                }
              />
            ) : preview?.problem ? (
              <span className="max-w-md whitespace-normal p-6">{preview.problem}</span>
            ) : (
              <Skeleton className="size-full" />
            )}
            <span className="absolute right-3 bottom-3 rounded-md bg-background/80 p-1.5" aria-hidden="true">
              <ExpandIcon />
            </span>
          </Button>
        ) : (
          <p className="max-w-md p-6 text-center text-sm text-muted-foreground">
            {active.problem ??
              (active.binding.complete
                ? "Example relationship unavailable"
                : "Example processing is incomplete")}
          </p>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-2" data-slot="civitai-gallery-controls">
        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Previous example"
          disabled={opening || index === 0}
          onClick={() => move(-1)}
        >
          <ChevronLeftIcon />
        </Button>
        <div className="h-16 min-w-0 flex-1" data-slot="civitai-gallery-strip">
          {!!examples.length && (
            <ScrollArea
              className="h-full w-full"
              viewportProps={{ ref: strip }}
              scrollbarProps={{ orientation: "horizontal" }}
            >
              <ToggleGroup
                aria-label="Choose example"
                variant="outline"
                value={activeKey ? [activeKey] : []}
                disabled={opening}
                onValueChange={(values) => {
                  if (values[0]) setSelected(values[0])
                }}
                className="pb-2"
              >
                {examples.map(({ representative: example }, exampleIndex) => {
                  const key = exampleKey(example)
                  const isVideo = example.binding.media.some((media) => media.kind === "video")
                  const image = example.binding.media.find(media => media.kind === "image")
                  const marked = isCover(example)
                  return (
                    <div key={key} className="group/gallery-thumbnail relative shrink-0" data-card-cover={marked || undefined}>
                    <ToggleGroupItem
                      value={key}
                      className="h-14 w-20 overflow-hidden p-1"
                      aria-label={`Show example ${exampleIndex + 1}`}
                      ref={(element) => {
                        if (element) buttons.current.set(key, element)
                        else buttons.current.delete(key)
                      }}
                    >
                      {example.applicable && example.binding.complete ? (
                        <ManagedThumbnail
                          key={revision}
                          api={api}
                          example={example}
                          onPreview={reportPreview}
                          viewport={strip}
                          selected={key === activeKey}
                        />
                      ) : isVideo ? (
                        <VideoIcon />
                      ) : (
                        <ImageIcon />
                      )}
                    </ToggleGroupItem>
                    {covers && originEntity && (
                      <Button variant="secondary" size="icon-xs" className={`absolute right-1 bottom-2 z-10 rounded-sm aria-disabled:opacity-50 ${marked ? "" : "opacity-0 group-hover/gallery-thumbnail:opacity-100 group-focus-within/gallery-thumbnail:opacity-100 focus-visible:opacity-100"}`}
                        aria-label={marked ? "Use automatic card cover" : `Set example ${exampleIndex + 1} as card cover`}
                        aria-pressed={marked} aria-disabled={coverState?.pending || !!coverState?.attempt}
                        title={marked ? "Card cover · click to clear" : "Set as card cover"}
                        disabled={opening || !marked && (!example.applicable || !example.binding.complete || !image)}
                        onClick={() => {
                          if (coverState?.pending || coverState?.attempt) return
                          if (marked) void covers.choose(originEntity, null)
                          else if (image) void covers.choose(originEntity, { source_component_id: example.source.component_id, version_id: unit.version.id, target_entity_id: example.binding.entity_id, target_file_id: example.binding.file_id, image_component_id: image.component_id })
                        }}><StarIcon className={marked ? "fill-current" : undefined} /></Button>
                    )}
                    </div>
                  )
                })}
              </ToggleGroup>
            </ScrollArea>
          )}
        </div>

        <Button
          variant="outline"
          size="icon-sm"
          aria-label="Next example"
          disabled={opening || index >= examples.length - 1}
          onClick={() => move(1)}
        >
          <ChevronRightIcon />
        </Button>
        <div className="flex shrink-0 flex-col items-center gap-1">
          <span
            ref={count}
            tabIndex={-1}
            className="min-w-12 text-center text-xs tabular-nums text-muted-foreground"
            aria-live="polite"
            data-slot="civitai-gallery-count"
          >
            {examples.length ? `${index + 1} / ${examples.length}` : "0 saved"}
          </span>
          <div className="flex items-center gap-0.5">
          {outsideCover && covers && originEntity && (
            <Button variant="ghost" size="icon-sm" aria-label="Use automatic card cover" title={`Card cover from version ${savedCover.version_id} · click to clear`}
              aria-pressed="true" aria-disabled={coverState?.pending || !!coverState?.attempt}
              onClick={event => {
                if (coverState?.pending || coverState?.attempt) return
                const trigger = event.currentTarget
                void covers.choose(originEntity, null).then(() => {
                  const observed = covers.get(originEntity).observed
                  if (observed?.status === "saved" && !observed.cover && (document.activeElement === trigger || document.activeElement === document.body)) count.current?.focus({ preventScroll: true })
                })
              }}><StarIcon className="fill-current" /></Button>
          )}
          {active && (
            <Dialog>
              <DialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Example sources"
                    title="Example sources"
                  />
                }
              >
                <InfoIcon />
              </DialogTrigger>
              <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                  <DialogTitle>Example sources</DialogTitle>
                  <DialogDescription>
                    {video ? "Video" : "Image"} {index + 1} of {examples.length} · saved file and source
                    observations.
                  </DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[60vh]" viewportProps={{ className: "max-h-[60vh]" }}>
                  <div className="flex flex-col gap-4 pr-2 text-xs [overflow-wrap:anywhere]">
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
                      <dt className="text-muted-foreground">Entity</dt>
                      <dd>{active.binding.entity_id}</dd>
                      <dt className="text-muted-foreground">File</dt>
                      <dd>{active.binding.file_id}</dd>
                      <dt className="text-muted-foreground">Type</dt>
                      <dd>{active.binding.content_type}</dd>
                    </dl>
                    {examples[index].contributors.map((contributor, contributorIndex) => (
                      <div
                        key={`${contributor.source.component_id}:${contributor.binding.occurrence}:${contributorIndex}`}
                        className="flex flex-col gap-1.5"
                      >
                        <p className="font-medium">Source {contributorIndex + 1}</p>
                        <p className="text-muted-foreground">Entity {contributor.source.entity_id}</p>
                        <p>
                          Occurrence {contributor.binding.occurrence + 1} ·{" "}
                          {contributor.applicable ? "Applicable" : (contributor.problem ?? "Unavailable")}
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </DialogContent>
            </Dialog>
          )}
          </div>
        </div>
      </div>
      {covers && originEntity && (coverState?.problem || coverState?.unavailable) && (
        <p role="alert" className="text-xs text-destructive">{coverState.problem ?? coverState.unavailable}
          {coverState.problem && <Button size="sm" variant="ghost" disabled={coverState.pending} onClick={() => void covers.retry(originEntity)}>Check cover</Button>}
        </p>
      )}
    </section>
  )
}
const noSubscribe = () => () => {}
const zero = () => 0

function ManagedThumbnail({
  api,
  example,
  onPreview,
  viewport,
  selected,
}: {
  api: BackendApi
  example: Wire<"CivitaiManagedExample">
  onPreview: (key: string, value: Preview | undefined) => void
  viewport: { current: HTMLDivElement | null }
  selected: boolean
}) {
  const element = useRef<HTMLSpanElement>(null)
  const [nearby, setNearby] = useState(false)
  useEffect(() => {
    if (!element.current) return
    const observer = new IntersectionObserver(([entry]) => setNearby(entry.isIntersecting), {
      root: viewport.current,
      rootMargin: "0px 160px",
    })
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [viewport])
  const needed = selected || nearby
  const [url, setUrl] = useState<string>()
  const [problem, setProblem] = useState<string>()
  const key = exampleKey(example)
  useEffect(() => {
    setUrl(undefined)
    setProblem(undefined)
    if (!needed) return
    const controller = new AbortController()
    let objectUrl: string | undefined
    let current = true
    void (async () => {
      const result = await api.memberships([example.binding.entity_id])
      if (!current) return
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
      const mediaKind = target.kind === "image" ? "aadf84d2-0dc0-4a81-8cdb-901162c78321" : "f4be9375-60f1-4d04-8f07-8c9ad765e230"
      if (!member.memberships.some(membership => membership.kind_id === mediaKind && membership.component_id === target.component_id))
        throw new Error("Example Media membership changed")
      const preview = await api.savedPreview(target.kind, target.component_id)
      if (!current) return
      if (!preview || preview.kind !== target.kind || preview.file_id !== example.binding.file_id)
        throw new Error("The already-produced preview is unavailable; rereading does not generate it")
      const bytes = await api.previewBytes(preview.locator, controller.signal)
      const currentMembers = await api.memberships([example.binding.entity_id])
      const currentMember = currentMembers.find(member => member.entity_id === example.binding.entity_id)
      if (currentMember?.status !== "present" || !currentMember.memberships.some(member => member.component_id === example.binding.file_id && member.kind_id === "9fd73d3d-d35d-41bc-8b73-402e12f5c017") || !currentMember.memberships.some(member => member.kind_id === mediaKind && member.component_id === target.component_id))
        throw new Error("Example membership changed while loading")
      if (!current) return
      objectUrl = URL.createObjectURL(bytes)
      if (current) {
        setUrl(objectUrl)
        onPreview(key, { url: objectUrl })
      }
    })().catch((error) => {
      if (current) {
        const message = errorText(error)
        setProblem(message)
        onPreview(key, { problem: message })
      }
    })
    return () => {
      current = false
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      onPreview(key, undefined)
    }
  }, [api, example.binding.entity_id, example.binding.file_id, key, onPreview, needed])
  return (
    <span ref={element} className="flex size-full items-center justify-center">
      {problem ? (
        <ImageIcon aria-label="Preview unavailable" />
      ) : url ? (
        <img
          src={url}
          alt="Managed Civitai example"
          className="size-full object-contain"
          onError={() => {
            const message = "Managed image could not be displayed. Reread the selected version to retry."
            setProblem(message)
            onPreview(key, { problem: message })
          }}
        />
      ) : (
        <Skeleton className="size-full" />
      )}
    </span>
  )
}
