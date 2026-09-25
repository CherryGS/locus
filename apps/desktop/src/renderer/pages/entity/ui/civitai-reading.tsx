import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { ArrowUpRightIcon, RefreshCwIcon, UserRoundIcon } from "lucide-react"
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
import { SourceLink, type EntityItem } from "@/entities/entity"
import { CivitaiGallery } from "./civitai-gallery"

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
  const model = page?.origin.record.model
  // Optional provider fields belong to their own saved model or version source.
  const creator = sourceObject(sourceObject(model?.raw_json).creator)
  const creatorName = typeof creator.username === "string" ? creator.username : undefined
  const versionFields = sourceObject(unit?.version.raw_json)
  const trainedWords = Array.isArray(versionFields.trainedWords)
    ? versionFields.trainedWords.filter((word): word is string => typeof word === "string" && !!word)
    : []
  const published =
    typeof versionFields.publishedAt === "string" && Number.isFinite(Date.parse(versionFields.publishedAt))
      ? new Date(versionFields.publishedAt)
      : undefined
  const focusedFile = unit?.version.files.find((item) => item.id === selection?.file)
  const fileFields = sourceObject(focusedFile?.raw_json)
  const fileMetadata = sourceObject(fileFields.metadata)
  const operationAttention =
    coordinator.newBlocked(entity.id) ||
    !!coordinator.problem ||
    coordinator.operations.some(
      (operation) =>
        operation.outcome.entity_id === entity.id &&
        (!!operation.active_request_id || operation.outcome.state !== "complete"),
    )
  const [maintenanceOpen, setMaintenanceOpen] = useState(false)
  useEffect(() => {
    if (operationAttention) setMaintenanceOpen(true)
  }, [operationAttention])
  const maintenance = (
    <details
      open={maintenanceOpen}
      onToggle={(event) => setMaintenanceOpen(event.currentTarget.open)}
      className="text-xs"
      data-slot="civitai-maintenance"
    >
      <summary className="cursor-pointer text-muted-foreground">
        Library maintenance{operationAttention ? " · needs attention" : ""}
      </summary>
      <div className="flex flex-col gap-3 pt-3">
        <p className="text-muted-foreground">
          Refresh uses this entry's local file, independently of the version being viewed.
        </p>
        <CivitaiActions
          coordinator={coordinator}
          entityId={entity.id}
          fileId={file?.readStatus === "ready" ? file.id : undefined}
          firstOnly={false}
        />
      </div>
    </details>
  )
  return (
    <ScrollArea className="min-h-0 flex-1">
      <article
        className="@container mx-auto flex w-full max-w-6xl flex-col gap-5 p-5 sm:p-6"
        data-slot="civitai-page"
        aria-label="Civitai model"
      >
        <header className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{model?.name ?? "Civitai"}</h1>
              {model && (
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <Badge variant="secondary">
                    {model.kind === "TextualInversion" ? "Embedding" : model.kind}
                  </Badge>
                  {creatorName && (
                    <span className="inline-flex items-center gap-1.5">
                      <UserRoundIcon className="size-3.5" aria-hidden="true" />
                      {creatorName}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-3">
              {model && (
                <span className="text-xs text-muted-foreground">
                  <SourceLink url={`https://civitai.com/models/${model.id}`}>
                    <span className="inline-flex items-center gap-1">
                      View on Civitai
                      <ArrowUpRightIcon className="size-3.5" aria-hidden="true" />
                    </span>
                  </SourceLink>
                </span>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Reread saved information"
                title="Reread saved information"
                disabled={pending}
                onClick={() => setRetry((value) => value + 1)}
              >
                {pending ? <Spinner /> : <RefreshCwIcon />}
              </Button>
            </div>
          </div>
          {!!model?.tags.length && (
            <div className="flex flex-wrap gap-1.5">
              {model.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </header>
        {problem && (
          <Alert variant="destructive">
            <AlertTitle>Page read failed</AlertTitle>
            <AlertDescription>{problem}</AlertDescription>
          </Alert>
        )}
        {pending && page && (
          <p role="status" className="text-xs text-muted-foreground">
            Previous Page observation · rereading saved information.
          </p>
        )}
        {(unitPending || pending) && unit && (
          <p role="status" className="text-xs text-muted-foreground">
            Previous version observation · rereading selected source.
          </p>
        )}
        {unitProblem && unit && (
          <p role="status" className="text-xs text-muted-foreground">
            Previous version observation · the latest source read failed.
          </p>
        )}
        {!page || !model ? (
          <>
            <Empty>
              <EmptyHeader>
                <EmptyTitle>
                  {pending ? "Reading saved Civitai information…" : "Saved information unavailable"}
                </EmptyTitle>
                <EmptyDescription>
                  Use the reread button to load this entry's saved information.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
            {maintenance}
          </>
        ) : (
          <>
            {page.origin.input !== "current" && (
              <Alert>
                <AlertDescription>
                  Origin input: {page.origin.input}. {page.origin.problem} Saved information is retained.
                </AlertDescription>
              </Alert>
            )}
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
                <section className="flex flex-wrap items-center gap-3" aria-label="Civitai versions">
                  <h2 className="text-sm text-muted-foreground">Version</h2>
                  <ToggleGroup
                    aria-label="Civitai version"
                    variant="outline"
                    size="sm"
                    className="min-w-0 max-w-full flex-wrap"
                    value={selection ? [selection.version] : []}
                    onValueChange={(values) => {
                      if (values[0]) choose({ model: model.id, version: values[0] })
                    }}
                  >
                    {page.versions.map((version) => {
                      const versionName = model.versions.find((item) => item.id === version.id)?.name
                      const name = versionName ?? `Version ${version.id}`
                      return (
                        <ToggleGroupItem
                          key={version.id}
                          value={version.id}
                          className="min-w-0 max-w-full"
                          aria-label={`${versionName ? `${versionName} · ` : ""}Version ${version.id}${version.in_origin ? "" : " · not recorded in this snapshot"}`}
                          title={`Version ${version.id}${version.id === page.origin.record.matched_version ? " · matched to this entry" : ""}`}
                        >
                          <span className="truncate">{name}</span>
                          {!version.in_origin && <span>· not recorded in this snapshot</span>}
                        </ToggleGroupItem>
                      )
                    })}
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
                  <Alert>
                    <AlertTitle>Version not recorded in this snapshot</AlertTitle>
                    <AlertDescription>
                      <p>
                        Choose the saved version information to read. The model information still belongs to
                        this entry.
                      </p>
                      <ToggleGroup
                        aria-label="Version source"
                        variant="outline"
                        size="sm"
                        className="max-w-full flex-wrap"
                        value={selection?.source ? [selection.source] : []}
                        onValueChange={(values) => {
                          if (values[0]) choose({ ...selection!, source: values[0] })
                        }}
                      >
                        {member.sources.map((source) => (
                          <ToggleGroupItem
                            key={source.component_id}
                            value={source.component_id}
                            title={source.entity_id}
                          >
                            Source Entity {source.entity_id.slice(-8)}
                          </ToggleGroupItem>
                        ))}
                      </ToggleGroup>
                      {selection?.source && !eligible && (
                        <p>The selected source is no longer eligible. No replacement was selected.</p>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
              </>
            )}
            {unitProblem && (
              <Alert>
                <AlertTitle>Selected version observation</AlertTitle>
                <AlertDescription>
                  {unitProblem}
                  <Button variant="outline" size="sm" onClick={() => setRetry((value) => value + 1)}>
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
            <Separator />
            <div className="grid min-w-0 items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_17rem]">
              <div className="flex min-w-0 flex-col gap-6 @3xl:col-start-1">
                {unit && (
                  <CivitaiGallery
                    api={api}
                    unit={unit}
                    opening={opening}
                    revision={`${retry}:${coordinator.projectionRevision}`}
                    onOpen={(target) => void openExample(target)}
                  />
                )}
                {unitPending && !unit && (
                  <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Spinner />
                    Reading version…
                  </div>
                )}
              </div>
              <aside
                aria-label="Version information"
                className="flex min-w-0 flex-col gap-4 @3xl:col-start-2 @3xl:row-span-2 @3xl:row-start-1"
              >
                {unit && (
                  <>
                    <Card size="sm">
                      <CardHeader>
                        <CardDescription>Selected version</CardDescription>
                        <CardTitle>{unit.version.name}</CardTitle>
                        {!unit.in_origin && (
                          <CardDescription>From Entity {unit.source.entity_id.slice(-8)}</CardDescription>
                        )}
                      </CardHeader>
                      <CardContent className="flex flex-col gap-4">
                        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 text-xs">
                          <dt className="text-muted-foreground">Base model</dt>
                          <dd className="text-right">{unit.version.base_model ?? "Not recorded"}</dd>
                          {published && (
                            <>
                              <dt className="text-muted-foreground">Published</dt>
                              <dd className="text-right" title={published.toLocaleString()}>
                                {published.toLocaleDateString()}
                              </dd>
                            </>
                          )}
                        </dl>
                        {!!trainedWords.length && (
                          <div className="flex flex-col gap-2">
                            <h3 className="text-xs text-muted-foreground">Trigger words</h3>
                            <div className="flex flex-wrap gap-1.5">
                              {trainedWords.map((word, index) => (
                                <Badge variant="secondary" key={index}>
                                  {word}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}
                        <Separator />
                        <section aria-label="Version files" className="flex min-w-0 flex-col gap-3">
                          <h3 className="text-xs text-muted-foreground">Files listed by this source</h3>
                          <ToggleGroup
                            aria-label="Version file"
                            variant="outline"
                            orientation="vertical"
                            size="sm"
                            className="w-full min-w-0"
                            value={selection?.file ? [selection.file] : []}
                            onValueChange={(values) => {
                              setSelectionNotice(undefined)
                              setSelection({ ...selection!, file: values[0] })
                            }}
                          >
                            {unit.version.files.map((item) => (
                              <ToggleGroupItem
                                key={item.id}
                                value={item.id}
                                aria-label={`${item.name} · ${item.id}`}
                                title={`${item.name} · ${item.kind} · ${item.id}`}
                                className="min-w-0 max-w-full justify-start"
                              >
                                <span className="truncate">{item.name}</span>
                              </ToggleGroupItem>
                            ))}
                          </ToggleGroup>
                          {!unit.version.files.length && (
                            <p className="text-xs text-muted-foreground">
                              No files listed in this observation.
                            </p>
                          )}
                          {focusedFile && (
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                              {typeof fileMetadata.format === "string" && <span>{fileMetadata.format}</span>}
                              {typeof fileMetadata.fp === "string" && <span>{fileMetadata.fp}</span>}
                              {typeof fileFields.sizeKB === "number" &&
                                Number.isFinite(fileFields.sizeKB) && (
                                  <span>
                                    {new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
                                      fileFields.sizeKB,
                                    )}{" "}
                                    KB (source)
                                  </span>
                                )}
                            </div>
                          )}
                        </section>
                      </CardContent>
                    </Card>
                    <details data-slot="civitai-version-notes" className="text-sm">
                      <summary className="cursor-pointer font-medium">Version notes</summary>
                      <p className="pt-3 whitespace-pre-wrap text-sm leading-6 [overflow-wrap:anywhere]">
                        {providerText(unit.version.description) ?? "No version notes saved."}
                      </p>
                    </details>
                    <Separator />
                    <details className="text-xs" data-slot="civitai-library-links">
                      <summary className="cursor-pointer text-muted-foreground">
                        Library links · {unit.correspondences.length} recorded
                      </summary>
                      <div className="flex flex-col gap-3 pt-3 [overflow-wrap:anywhere]">
                        <p className="text-muted-foreground">
                          Recorded local correspondences for this version.
                        </p>
                        {unit.correspondences.length ? (
                          unit.correspondences.map((correspondence) => (
                            <div key={correspondence.source.component_id} className="flex flex-col gap-1">
                              <p>Entity {correspondence.source.entity_id}</p>
                              <p className="text-muted-foreground">
                                File {correspondence.file} · {correspondence.input}
                              </p>
                              {!unit.version.files.some((item) => item.id === correspondence.file) && (
                                <p>File not listed by the chosen source.</p>
                              )}
                              {correspondence.problem && <p>{correspondence.problem}</p>}
                            </div>
                          ))
                        ) : (
                          <p>
                            No recorded local correspondence in this read. This does not prove absence from
                            the library.
                          </p>
                        )}
                      </div>
                    </details>
                  </>
                )}
                {maintenance}
              </aside>
              <section aria-label="About this model" className="flex min-w-0 flex-col gap-3 @3xl:col-start-1">
                <h2 className="text-sm font-medium">About this model</h2>
                <p className="whitespace-pre-wrap text-sm leading-7 [overflow-wrap:anywhere]">
                  {providerText(model.description) ?? "No model description saved."}
                </p>
              </section>
            </div>
            <Separator />
            <details className="text-xs text-muted-foreground" data-slot="civitai-source-details">
              <summary className="cursor-pointer">Source details</summary>
              <div className="flex flex-col gap-4 pt-4 [overflow-wrap:anywhere]">
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
                  <dt>Origin Entity</dt>
                  <dd>{entity.id}</dd>
                  <dt>Model</dt>
                  <dd>
                    {model.id} · {model.kind}
                  </dd>
                  <dt>Matched version</dt>
                  <dd>{page.origin.record.matched_version}</dd>
                  <dt>Matched file</dt>
                  <dd>{page.origin.record.matched_file}</dd>
                  {unit && (
                    <>
                      <dt>Version source</dt>
                      <dd>{unit.in_origin ? "This entry" : `Entity ${unit.source.entity_id}`}</dd>
                      <dt>Observation</dt>
                      <dd>{unit.source.observation}</dd>
                    </>
                  )}
                </dl>
                {focusedFile && (
                  <details key={focusedFile.id}>
                    <summary className="cursor-pointer">
                      {focusedFile.name} · {focusedFile.kind} · provider declarations
                    </summary>
                    <pre className="overflow-auto pt-3 whitespace-pre-wrap break-words text-xs">
                      {focusedFile.raw_json}
                    </pre>
                  </details>
                )}
              </div>
            </details>
          </>
        )}
      </article>
    </ScrollArea>
  )
}

function sourceObject(value: unknown): Record<string, unknown> {
  try {
    const object: unknown = typeof value === "string" ? JSON.parse(value) : value
    return object && typeof object === "object" && !Array.isArray(object)
      ? (object as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}
