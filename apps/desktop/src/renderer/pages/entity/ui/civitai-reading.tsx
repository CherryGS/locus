import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { ArrowUpRightIcon, CheckIcon, FileIcon, RefreshCwIcon, UserRoundIcon } from "lucide-react"
import { errorText, type BackendApi, type Wire } from "@/shared/api"
import { CivitaiActions, type CivitaiCoordinator } from "@/features/civitai"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/shared/ui/card"
import { Alert, AlertTitle, AlertDescription } from "@/shared/ui/alert"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/shared/ui/empty"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { Spinner } from "@/shared/ui/spinner"
import { Separator } from "@/shared/ui/separator"
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group"
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/shared/ui/table"
import type { CivitaiSelection, RelatedCollection } from "../model/navigation"
import { SourceLink, type EntityItem } from "@/entities/entity"
import { CivitaiGallery } from "./civitai-gallery"
import { CivitaiRichText } from "./civitai-rich-text"

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
  const requestedSource = member?.in_origin
    ? component
    : (selection?.source ?? member?.sources[0]?.component_id)
  const unitMatchesSelection =
    !!unit &&
    unit.model === selection?.model &&
    unit.version.id === selection?.version &&
    unit.source.component_id === requestedSource
  const displayedFile = useRef<string | undefined>(undefined)
  if (unitMatchesSelection) displayedFile.current = selection?.file
  useEffect(() => {
    if (!page || !selection || changedModel || !member || !eligible) {
      setUnit(undefined)
      setUnitPending(false)
      return
    }
    let current = true
    // Keep the last attributed version mounted until its replacement is read.
    // The presentation labels that previous version and blocks actions meanwhile.
    setUnitPending(true)
    setUnitProblem(undefined)
    void api
      .civitaiVersion(component, selection.version, selection.source)
      .then((value) => {
        if (!current) return
        if (
          value.model !== selection.model ||
          value.version.id !== selection.version ||
          value.source.component_id !== requestedSource
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
    setUnitPending(true)
    setUnitProblem(undefined)
    setSelectionNotice(undefined)
    setExampleProblem(undefined)
    setSelection(next)
  }
  async function openExample(target: string) {
    if (!selection || !unit || !unitMatchesSelection || unitPending || opening) return
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
  const focusedFile = unit?.version.files.find((item) => item.id === displayedFile.current)
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
  const versionStatus =
    unit && (unitPending || pending)
      ? unitMatchesSelection
        ? "Previous version observation · rereading selected source."
        : `Loading version… Showing ${unit.version.name}.`
      : unit && unitProblem
        ? unitMatchesSelection
          ? "Previous version observation · the latest source read failed."
          : `Selected version unavailable. Showing ${unit.version.name}.`
        : !unit && unitPending
          ? "Reading version…"
          : undefined
  const versionFiles = unit ? (
    <section aria-label="Version files" className="flex min-w-0 flex-col gap-2">
      <h3 className="text-xs text-muted-foreground">Source files</h3>
      <ToggleGroup
        aria-label="Version file"
        orientation="vertical"
        variant="outline"
        size="sm"
        className="w-full min-w-0"
        disabled={!unitMatchesSelection || unitPending}
        value={focusedFile ? [focusedFile.id] : []}
        onValueChange={(values) => {
          if (!values[0] || !unitMatchesSelection || unitPending) return
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
            className="h-auto w-full min-w-0 items-start justify-start gap-2 p-2.5 text-left"
          >
            <FileIcon className="mt-0.5 text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="truncate">{item.name}</span>
              <span className="text-xs font-normal whitespace-normal text-muted-foreground [overflow-wrap:anywhere]">
                {sourceFileSummary(item)}
              </span>
            </span>
            <CheckIcon className="mt-0.5 opacity-0 group-aria-pressed/toggle:opacity-100" />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {!unit.version.files.length && (
        <p className="text-xs text-muted-foreground">No files listed in this observation.</p>
      )}
    </section>
  ) : null
  const libraryDetails = (
    <section
      aria-label="Library and source"
      className="flex min-w-0 flex-col gap-4"
      data-slot="civitai-reading-details"
    >
      <h2 className="text-sm font-medium">Library &amp; source</h2>
      {maintenance}
      {page && model && (
        <>
          {unit && (
            <details className="text-xs" data-slot="civitai-library-links">
              <summary className="cursor-pointer text-muted-foreground">
                Library links · {unit.version.name} · {unit.correspondences.length} recorded
              </summary>
              <div className="flex flex-col gap-3 pt-3 [overflow-wrap:anywhere]">
                <p className="text-muted-foreground">Recorded local correspondences for this version.</p>
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
                    No recorded local correspondence in this read. This does not prove absence from the
                    library.
                  </p>
                )}
              </div>
            </details>
          )}
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
    </section>
  )
  return (
    <ScrollArea className="min-h-0 flex-1">
      <article
        className="@container mx-auto flex w-full max-w-6xl flex-col gap-4 p-5 sm:p-6"
        data-slot="civitai-page"
        aria-label="Civitai model"
      >
        <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="text-xl font-semibold tracking-tight">{model?.name ?? "Civitai"}</h1>
            {model && (
              <Badge variant="secondary">
                {model.kind === "TextualInversion" ? "Embedding" : model.kind}
              </Badge>
            )}
            {creatorName && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <UserRoundIcon className="size-3.5" aria-hidden="true" />
                {creatorName}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {model && (
              <span className="mr-1 text-xs text-muted-foreground">
                <SourceLink url={`https://civitai.com/models/${model.id}`}>
                  <span className="inline-flex items-center gap-1">
                    Civitai
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
                  <div
                    role="status"
                    data-slot="civitai-version-status"
                    title={versionStatus}
                    className="flex h-5 min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground"
                  >
                    {(unitPending || pending) && <Spinner />}
                    <span className="truncate">{versionStatus}</span>
                  </div>
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
            {unit ? (
              <CivitaiGallery
                key={`${unit.model}:${unit.version.id}:${unit.source.component_id}`}
                api={api}
                unit={unit}
                opening={opening || unitPending || !unitMatchesSelection}
                revision={`${retry}:${coordinator.projectionRevision}`}
                onOpen={(target) => void openExample(target)}
              />
            ) : (
              <div className="flex h-80 items-center justify-center rounded-xl border text-sm text-muted-foreground">
                {unitPending
                  ? "Reading examples…"
                  : "Select an available version source to read its examples."}
              </div>
            )}
            {unit && (
              <>
                <section
                  aria-label="Version information"
                  className="flex min-w-0 flex-col gap-3"
                  aria-busy={unitPending}
                >
                  <h2 className="text-sm font-medium">Version details</h2>
                  <div className="overflow-hidden rounded-lg border">
                    <Table aria-label="Version details" className="table-fixed">
                      <colgroup>
                        <col className="w-28" />
                        <col />
                      </colgroup>
                      <TableBody>
                        <TableRow>
                          <TableHead scope="row" className="px-3 text-xs text-muted-foreground">
                            Version
                          </TableHead>
                          <TableCell className="px-3 whitespace-normal [overflow-wrap:anywhere]">
                            {unit.version.name}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableHead scope="row" className="px-3 text-xs text-muted-foreground">
                            Base model
                          </TableHead>
                          <TableCell className="px-3 whitespace-normal [overflow-wrap:anywhere]">
                            {unit.version.base_model ?? "Not recorded"}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableHead scope="row" className="px-3 text-xs text-muted-foreground">
                            Published
                          </TableHead>
                          <TableCell className="px-3">
                            {published ? (
                              <time dateTime={published.toISOString()} title={published.toLocaleString()}>
                                {published.toLocaleDateString()}
                              </time>
                            ) : (
                              "Not recorded"
                            )}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableHead scope="row" className="px-3 text-xs text-muted-foreground">
                            Source
                          </TableHead>
                          <TableCell className="px-3 whitespace-normal [overflow-wrap:anywhere]">
                            {unit.in_origin
                              ? "This entry’s snapshot"
                              : `Entity ${unit.source.entity_id.slice(-8)}`}
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableHead
                            scope="row"
                            className="px-3 py-2.5 align-top text-xs text-muted-foreground"
                          >
                            Trigger words
                          </TableHead>
                          <TableCell className="px-3 whitespace-normal [overflow-wrap:anywhere]">
                            {trainedWords.length ? (
                              <ul className="flex min-w-0 flex-col gap-2">
                                {trainedWords.map((word, index) => (
                                  <li key={index}>
                                    <code className="select-text text-xs">{word}</code>
                                  </li>
                                ))}
                              </ul>
                            ) : Array.isArray(versionFields.trainedWords) ? (
                              "None listed"
                            ) : (
                              "Not recorded"
                            )}
                          </TableCell>
                        </TableRow>
                      </TableBody>
                    </Table>
                  </div>
                  {versionFiles}
                </section>
                <section aria-label="Version notes" data-slot="civitai-version-notes" className="min-w-0">
                  <Card>
                    <CardHeader className="border-b">
                      <CardTitle>
                        <h2>Version notes</h2>
                      </CardTitle>
                      <CardDescription>{unit.version.name}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <CivitaiRichText
                        html={unit.version.description}
                        baseUrl={`https://civitai.com/models/${model.id}?modelVersionId=${unit.version.id}`}
                        empty="No version notes saved."
                      />
                    </CardContent>
                  </Card>
                </section>
              </>
            )}
            <section aria-label="Model description" className="flex min-w-0 flex-col gap-4 py-2">
              <header className="flex flex-col gap-3 border-b pb-4">
                <h2 className="text-base font-semibold">Model description</h2>
                {!!model.tags.length && (
                  <dl className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
                    <dt className="text-xs text-muted-foreground">Model tags</dt>
                    <dd className="flex min-w-0 flex-wrap gap-1.5">
                      {model.tags.map((tag) => (
                        <Badge key={tag} variant="outline">
                          {tag}
                        </Badge>
                      ))}
                    </dd>
                  </dl>
                )}
              </header>
              <CivitaiRichText
                html={model.description}
                baseUrl={`https://civitai.com/models/${model.id}`}
                empty="No model description saved."
              />
            </section>
            <Separator />
            {libraryDetails}
          </>
        )}
      </article>
    </ScrollArea>
  )
}

function sourceFileSummary(file: Wire<"CivitaiFile">): string {
  const fields = sourceObject(file.raw_json)
  const metadata = sourceObject(fields.metadata)
  return [
    typeof metadata.format === "string" ? metadata.format : file.kind,
    typeof metadata.fp === "string" ? metadata.fp : undefined,
    typeof fields.sizeKB === "number" && Number.isFinite(fields.sizeKB)
      ? `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(fields.sizeKB)} KB`
      : undefined,
  ]
    .filter(Boolean)
    .join(" · ")
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
