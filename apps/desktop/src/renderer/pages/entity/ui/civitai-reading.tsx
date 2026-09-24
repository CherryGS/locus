import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { errorText, type BackendApi, type Wire } from "@/shared/api"
import { CivitaiActions, type CivitaiCoordinator } from "@/features/civitai"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/shared/ui/card"
import { Alert, AlertTitle, AlertDescription } from "@/shared/ui/alert"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/shared/ui/empty"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { Spinner } from "@/shared/ui/spinner"
import { Separator } from "@/shared/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group"
import { providerText } from "@/shared/lib/provider-text"
import type { CivitaiSelection, RelatedCollection } from "../model/navigation"
import type { EntityItem } from "@/entities/entity"

export function CivitaiReading({
  api,
  coordinator,
  entity,
  component,
  initial,
  onSelection,
  onRelated,
}: {
  api: BackendApi
  coordinator: CivitaiCoordinator
  entity: EntityItem
  component: string
  initial?: CivitaiSelection
  onSelection: (selection: CivitaiSelection) => void
  onRelated: (collection: RelatedCollection, entity: EntityItem) => void
}) {
  useSyncExternalStore(coordinator.subscribe, coordinator.snapshot)
  const [page, setPage] = useState<Wire<"CivitaiPage">>()
  const [unit, setUnit] = useState<Wire<"CivitaiVersionView">>()
  const [selection, setSelection] = useState<CivitaiSelection | undefined>(initial)
  const [problem, setProblem] = useState<string>()
  const [unitProblem, setUnitProblem] = useState<string>()
  const [selectionNotice, setSelectionNotice] = useState<string>()
  const [exampleProblem, setExampleProblem] = useState<string>()
  const [pending, setPending] = useState(false)
  const [unitPending, setUnitPending] = useState(false)
  const [retry, setRetry] = useState(0)
  const [opening, setOpening] = useState(false)
  const selected = useRef(selection)
  selected.current = selection
  const generation = useRef(0)
  const mounted = useRef(true)
  const changedSource = useRef(false)
  const openingGeneration = useRef(0)
  useEffect(() => {
    openingGeneration.current++
    setOpening(false)
    setExampleProblem(undefined)
  }, [selection])
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  useEffect(() => {
    const ticket = ++generation.current
    let current = true
    setPending(true)
    void api
      .civitaiPage(component)
      .then((value) => {
        if (!current || generation.current !== ticket) return
        setProblem(undefined)
        setPage(value)
        if (!selected.current)
          setSelection({
            model: value.origin.record.model.id,
            version: value.origin.record.matched_version,
            file: value.origin.record.matched_file,
          })
      })
      .catch((e) => {
        if (current)
          setProblem(
            `${errorText(e)} Previous saved information, when shown, is not a current successful read.`,
          )
      })
      .finally(() => {
        if (current) setPending(false)
      })
    return () => {
      current = false
    }
  }, [api, component, retry, coordinator.projectionRevision])
  useEffect(() => {
    if (selection) onSelection(selection)
  }, [selection, onSelection])
  const member = page?.versions.find((v) => v.id === selection?.version)
  const changedModel = !!page && !!selection && page.origin.record.model.id !== selection.model
  const eligible =
    member?.in_origin ||
    (selection?.source
      ? member?.sources.some((s) => s.component_id === selection.source)
      : member?.sources.length === 1)
  useEffect(() => {
    if (!page || !selection || changedModel || !member || !eligible) {
      setUnit(undefined)
      setUnitPending(false)
      return
    }
    let current = true
    const requestedSource = member.in_origin
      ? component
      : (selection.source ?? member.sources[0]?.component_id)
    setUnit((previous) =>
      previous?.model === selection.model &&
      previous.version.id === selection.version &&
      previous.source.component_id === requestedSource
        ? previous
        : undefined,
    )
    setUnitPending(true)
    setUnitProblem(undefined)
    void api
      .civitaiVersion(component, selection.version, selection.source)
      .then((value) => {
        if (!current) return
        if (
          value.model !== selection.model ||
          value.version.id !== selection.version ||
          (selection.source && !value.in_origin && value.source.component_id !== selection.source)
        )
          throw new Error("Selected model/version/source attribution did not match")
        setUnit(value)
        if (!value.in_origin && !selection.source)
          setSelection((previous) =>
            previous ? { ...previous, source: value.source.component_id } : previous,
          )
        if (selection.file && !value.version.files.some((f) => f.id === selection.file)) {
          setSelectionNotice(
            "The focused file is not recorded by this source. Choose a current file; no replacement was selected.",
          )
          if (changedSource.current)
            setSelection((previous) => (previous ? { ...previous, file: undefined } : previous))
        } else setSelectionNotice(undefined)
        changedSource.current = false
      })
      .catch((e) => {
        if (current)
          setUnitProblem(
            `${errorText(e)} Selected source could not be read; no other source was substituted.`,
          )
      })
      .finally(() => {
        if (current) setUnitPending(false)
      })
    return () => {
      current = false
    }
  }, [api, component, page, selection?.version, selection?.source, changedModel, eligible, member])
  function choose(next: CivitaiSelection) {
    changedSource.current = next.source !== selection?.source
    setUnit(undefined)
    setUnitProblem(undefined)
    setSelectionNotice(undefined)
    setExampleProblem(undefined)
    setSelection(next)
  }
  async function openExample(target: string) {
    if (!selection || !unit || opening) return
    const attempt = ++openingGeneration.current
    setOpening(true)
    setExampleProblem(undefined)
    try {
      const current = await api.civitaiVersion(component, selection.version, selection.source)
      if (!mounted.current || selected.current !== selection || openingGeneration.current !== attempt) return
      if (
        current.model !== selection.model ||
        current.version.id !== selection.version ||
        (selection.source && !current.in_origin && current.source.component_id !== selection.source)
      )
        throw new Error("Example model/source attribution changed")
      const allowed = current.examples.filter((e) => e.applicable && e.binding.complete)
      if (!allowed.some((e) => e.binding.entity_id === target))
        throw new Error("The requested example relationship is no longer applicable.")
      const ids = [...new Set(allowed.map((e) => e.binding.entity_id))]
      onRelated(
        {
          id: `civitai:${component}:${selection.version}:${crypto.randomUUID()}`,
          name: `Civitai ${page?.origin.record.model.name} · version ${selection.version} examples`,
          ownerId: entity.id,
          viewId: "civitai.read",
          entityIds: ids,
          civitai: {
            component,
            model: selection.model,
            version: selection.version,
            source: selection.source,
            files: Object.fromEntries(allowed.map((e) => [e.binding.entity_id, e.binding.file_id])),
          },
        },
        { id: target, components: [] },
      )
    } catch (e) {
      if (mounted.current && selected.current === selection && openingGeneration.current === attempt)
        setExampleProblem(errorText(e))
    } finally {
      if (mounted.current && selected.current === selection && openingGeneration.current === attempt)
        setOpening(false)
    }
  }
  const file = entity.components.find((c) => c.kind === "file")
  const groups = new Map<string, Wire<"CivitaiManagedExample">[]>()
  for (const e of unit?.examples ?? []) {
    const key = `${e.binding.entity_id}:${e.binding.file_id}`
    groups.set(key, [...(groups.get(key) ?? []), e])
  }
  const examples = [...groups.values()].map((contributors) => ({
    representative: contributors.find((c) => c.applicable) ?? contributors[0],
    contributors,
  }))
  return (
    <ScrollArea className="min-h-0 flex-1">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6" data-slot="civitai-page">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Badge variant="outline">Origin Entity {entity.id.slice(-8)}</Badge>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => setRetry((v) => v + 1)}>
            {pending && <Spinner />}Reread saved information
          </Button>
        </div>
        {problem && (
          <Alert variant="destructive">
            <AlertTitle>Page read failed</AlertTitle>
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        )}
        {pending && page && <p role="status">Previous Page observation · rereading saved information.</p>}
        {(unitPending || pending) && unit && (
          <p role="status">Previous version observation · rereading selected source.</p>
        )}
        {unitProblem && unit && (
          <p role="status">Previous version observation · the latest source read failed.</p>
        )}
        <CivitaiActions
          coordinator={coordinator}
          entityId={entity.id}
          fileId={file?.readStatus === "ready" ? file.id : undefined}
          firstOnly={false}
        />
        {!page ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>
                {pending ? "Reading saved Civitai information…" : "Saved information unavailable"}
              </EmptyTitle>
              <EmptyDescription>
                Reading this page never acquires remote metadata or examples.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardDescription>
                  Model {page.origin.record.model.id} · {page.origin.record.model.kind} · origin snapshot
                </CardDescription>
                <CardTitle>{page.origin.record.model.name}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="whitespace-pre-wrap break-words">
                  {providerText(page.origin.record.model.description) ??
                    "No description recorded in this snapshot."}
                </p>
                <div className="flex flex-wrap gap-2">
                  {page.origin.record.model.tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
                {page.origin.input !== "current" && (
                  <Alert>
                    <AlertDescription>
                      Origin input: {page.origin.input}. {page.origin.problem} Saved information is retained.
                    </AlertDescription>
                  </Alert>
                )}
              </CardContent>
            </Card>
            {changedModel ? (
              <Alert>
                <AlertTitle>Origin now identifies another model</AlertTitle>
                <AlertDescription>
                  This excursion refers to model {selection?.model}. Exit and reopen the Civitai view to read
                  the origin’s current correspondence.
                </AlertDescription>
              </Alert>
            ) : (
              <>
                <section className="flex flex-col gap-3" aria-label="Civitai versions">
                  <h2 className="font-medium">Versions in saved observations</h2>
                  <ToggleGroup
                    aria-label="Civitai version"
                    variant="outline"
                    className="flex-wrap"
                    value={selection ? [selection.version] : []}
                    onValueChange={(values) => {
                      if (values[0]) choose({ model: page.origin.record.model.id, version: values[0] })
                    }}
                  >
                    {page.versions.map((v) => (
                      <ToggleGroupItem key={v.id} value={v.id}>
                        Version {v.id}
                        {!v.in_origin && " · not recorded in this snapshot"}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </section>
                {!member && (
                  <Alert>
                    <AlertDescription>
                      The selected version is no longer available in this origin-relative directory. Choose a
                      version; none was substituted.
                    </AlertDescription>
                  </Alert>
                )}
                {member && !member.in_origin && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Version not recorded in this snapshot</CardTitle>
                      <CardDescription>
                        Select a whole version/file source. The origin model description and right panel stay
                        unchanged.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-wrap gap-2">
                      <ToggleGroup
                        aria-label="Version source"
                        variant="outline"
                        className="flex-wrap"
                        value={selection?.source ? [selection.source] : []}
                        onValueChange={(values) => {
                          if (values[0]) choose({ ...selection!, source: values[0] })
                        }}
                      >
                        {member.sources.map((s) => (
                          <ToggleGroupItem key={s.component_id} value={s.component_id}>
                            Source Entity {s.entity_id.slice(-8)}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                      {selection?.source && !eligible && (
                        <p>The selected source is no longer eligible. No replacement was selected.</p>
                      )}
                    </CardContent>
                  </Card>
                )}
                {unitProblem && (
                  <Alert>
                    <AlertTitle>Selected version observation</AlertTitle>
                    <AlertDescription>
                      {unitProblem}
                      <Button variant="outline" size="sm" onClick={() => setRetry((v) => v + 1)}>
                        Retry saved version read
                      </Button>
                    </AlertDescription>
                  </Alert>
                )}
                {selectionNotice && (
                  <Alert>
                    <AlertTitle>Focused file coverage</AlertTitle>
                    <AlertDescription>{selectionNotice}</AlertDescription>
                  </Alert>
                )}
                {exampleProblem && (
                  <Alert>
                    <AlertTitle>Example opening unavailable</AlertTitle>
                    <AlertDescription>{exampleProblem}</AlertDescription>
                  </Alert>
                )}
                {unit && (
                  <>
                    <Card>
                      <CardHeader>
                        <CardDescription>
                          {unit.in_origin
                            ? "Origin-owned version"
                            : `Whole version from Entity ${unit.source.entity_id}`}{" "}
                          · observation {unit.source.observation}
                        </CardDescription>
                        <CardTitle>{unit.version.name}</CardTitle>
                      </CardHeader>
                      <CardContent className="flex flex-col gap-4">
                        <p className="whitespace-pre-wrap break-words">
                          {providerText(unit.version.description) ?? "No version description recorded."}
                        </p>
                        <p>Base model: {unit.version.base_model ?? "Not recorded"}</p>
                        <Separator />
                        <h3 className="font-medium">Files listed by this source</h3>
                        <ToggleGroup
                          aria-label="Version file"
                          variant="outline"
                          className="flex-wrap"
                          value={selection?.file ? [selection.file] : []}
                          onValueChange={(values) => {
                            setSelectionNotice(undefined)
                            setSelection({ ...selection!, file: values[0] })
                          }}
                        >
                          {unit.version.files.map((f) => (
                            <ToggleGroupItem key={f.id} value={f.id}>
                              {f.name} · {f.id}
                            </ToggleGroupItem>
                          ))}
                        </ToggleGroup>
                        {unit.version.files
                          .filter((f) => f.id === selection?.file)
                          .map((f) => (
                            <details key={f.id}>
                              <summary>
                                {f.name} · {f.kind} · provider declarations
                              </summary>
                              <pre className="overflow-auto whitespace-pre-wrap break-words text-xs">
                                {f.raw_json}
                              </pre>
                            </details>
                          ))}
                        <h3 className="font-medium">Recorded local correspondences</h3>
                        {unit.correspondences.length ? (
                          unit.correspondences.map((c) => (
                            <p key={c.source.component_id}>
                              Entity {c.source.entity_id} · file {c.file} · {c.input}
                              {!unit.version.files.some((f) => f.id === c.file) &&
                                " · file not listed by the chosen source"}
                              {c.problem && ` · ${c.problem}`}
                            </p>
                          ))
                        ) : (
                          <p>
                            No recorded local correspondence in this read. This does not prove absence from
                            the library.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                    <section aria-label="Managed Civitai examples" className="flex flex-col gap-3">
                      <h2 className="font-medium">Managed examples</h2>
                      <p className="text-sm text-muted-foreground">
                        {unit.version.images.length
                          ? `${unit.version.images.length} remote examples listed by the selected source. Remote listings are not admitted targets.`
                          : "This saved version lists no examples in its observed coverage."}
                      </p>
                      {!examples.length && (
                        <Empty>
                          <EmptyHeader>
                            <EmptyTitle>No managed examples in this read</EmptyTitle>
                            <EmptyDescription>
                              Switching versions does not download examples.
                            </EmptyDescription>
                          </EmptyHeader>
                        </Empty>
                      )}
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-4">
                        {examples.map(({ representative: e, contributors }) => (
                          <Card key={`${e.binding.entity_id}:${e.binding.file_id}`} size="sm">
                            <CardContent className="flex flex-col gap-2">
                              {e.applicable ? (
                                <>
                                  <ManagedThumbnail
                                    key={`${retry}:${coordinator.projectionRevision}`}
                                    api={api}
                                    example={e}
                                  />
                                  <Button
                                    variant="outline"
                                    disabled={opening}
                                    onClick={() => void openExample(e.binding.entity_id)}
                                  >
                                    Inspect managed example
                                  </Button>
                                </>
                              ) : (
                                <p>{e.problem ?? "Example relationship unavailable"}</p>
                              )}
                              <p className="break-all text-xs">Entity {e.binding.entity_id}</p>
                              <div className="flex flex-col gap-1">
                                {contributors.map((c, index) => (
                                  <p
                                    key={`${c.source.component_id}:${c.binding.occurrence}:${index}`}
                                    className="text-xs text-muted-foreground"
                                  >
                                    From {c.source.entity_id} · occurrence {c.binding.occurrence + 1} ·{" "}
                                    {c.binding.content_type} ·{" "}
                                    {c.applicable ? "applicable" : (c.problem ?? "unavailable")}
                                  </p>
                                ))}
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    </section>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </ScrollArea>
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
      const member = result.find((e) => e.entity_id === example.binding.entity_id)
      if (
        !member ||
        member.status !== "present" ||
        !member.memberships.some(
          (m) =>
            m.kind_id === "9fd73d3d-d35d-41bc-8b73-402e12f5c017" &&
            m.component_id === example.binding.file_id,
        )
      )
        throw new Error("Example current File no longer matches its relationship")
      const target = example.binding.media.find((m) => m.kind === "image") ?? example.binding.media[0]
      if (!target) throw new Error("No completed Media component")
      const preview = await api.savedPreview(target.kind, target.component_id)
      if (!preview || preview.file_id !== example.binding.file_id)
        throw new Error("The already-produced preview is unavailable; rereading does not generate it")
      const bytes = await api.previewBytes(preview.locator, controller.signal)
      objectUrl = URL.createObjectURL(bytes)
      if (current) setUrl(objectUrl)
    })().catch((e) => {
      if (current) setProblem(errorText(e))
    })
    return () => {
      current = false
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [api, example.binding.entity_id, example.binding.file_id])
  return problem ? (
    <p className="text-sm">{problem}</p>
  ) : url ? (
    <img
      src={url}
      alt="Managed Civitai example"
      className="aspect-square w-full object-contain"
      onError={() =>
        setProblem("Managed image could not be displayed. Reread the selected version to retry.")
      }
    />
  ) : (
    <Spinner />
  )
}
