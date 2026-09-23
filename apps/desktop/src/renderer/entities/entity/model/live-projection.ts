import type { Wire } from "@/shared/api"
import { diagnosticText } from "@/shared/api"
import type { EntityComponent } from "./entity-item"
import type { ReadProblem } from "./read-problem"

// Assigned owner identities from locus-file/src/identity.rs and
// locus-media/src/identity.rs; labels/type names are not kind authority.
export const supportedKinds = {
  "6c46d4eb-5c2f-46eb-9e81-f866884e3107": "model",
  "9fd73d3d-d35d-41bc-8b73-402e12f5c017": "file",
  "aadf84d2-0dc0-4a81-8cdb-901162c78321": "image",
  "f4be9375-60f1-4d04-8f07-8c9ad765e230": "video",
  "88ace9d7-8f02-4cc6-8f5b-add4dc6faf51": "twitter",
} as const
export function membershipProjection(membership: Wire<"Membership">): EntityComponent {
  const kind =
    (supportedKinds as Record<string, "file" | "image" | "video" | "twitter" | "model" | undefined>)[
      membership.kind_id
    ] ?? "unknown"
  return {
    id: membership.component_id,
    kind,
    kindId: membership.kind_id,
    readStatus: kind === "unknown" ? "unsupported" : "loading",
  } as EntityComponent
}
export function fileProjection(value: Wire<"FileMetadata">): EntityComponent {
  return {
    kind: "file",
    id: value.file_id,
    kindId: value.kind_id,
    bytes: value.byte_count,
    relativePath: value.relative_path,
    readStatus: "ready",
  }
}
export function mediaProjection(value: Wire<"MediaView">): EntityComponent {
  const { record, applicability } = value
  const current =
    applicability.status === "matching"
      ? applicability.file_id
      : applicability.status === "changed"
        ? applicability.current
        : applicability.status === "incomplete" && applicability.current.status === "file"
          ? applicability.current.file_id
          : undefined
  const base = {
    id: record.target.component_id,
    readStatus: "ready" as const,
    record,
    applicability,
  }
  if (record.target.kind === "image") {
    const facts = record.facts?.kind === "image" ? record.facts : undefined
    return {
      ...base,
      kind: "image",
      format: facts?.format,
      width: facts?.width,
      height: facts?.height,
      inputFileId: current,
    }
  }
  const facts = record.facts?.kind === "video" ? record.facts : undefined
  return {
    ...base,
    kind: "video",
    inputFileId: current,
    format: facts?.container,
    codec: facts?.codec ?? undefined,
    width: facts?.width ?? undefined,
    height: facts?.height ?? undefined,
    durationSeconds: facts?.duration?.seconds,
    durationPrecision: facts?.duration?.precision,
    streamIndex: facts?.stream_index,
  }
}
export function mediaProblems(view: Wire<"MediaView">): ReadProblem[] {
  const subject = `${view.record.target.kind} ${view.record.target.component_id}`
  const problems: ReadProblem[] = []
  const add = (key: string, message: string) => problems.push({ key, subject, message, recovery: "entity" })
  if (view.record.last_failure) add("attempt", `${view.record.last_failure.detail} (${view.record.last_failure.code})`)
  const context = view.applicability
  if (context.status === "changed")
    add("input", `Accepted facts describe File ${context.basis}; current input is File ${context.current}.`)
  if (context.status === "unmounted") add("input", "This component is no longer attached to an Entity.")
  if (context.status === "error") add("input", diagnosticText(context.diagnostic))
  if (context.status === "incomplete" && context.current.status !== "file")
    add("input", `Current File input is unavailable (${context.current.status.replaceAll("_", " ")}).`)
  return problems
}

// Retain the complete wire snapshot as well as the small card/reading projection.
// A successful reread replaces this object, so absent fields cannot inherit old values.
export function twitterProjection(value: Wire<"TwitterView">): EntityComponent {
  const { record, applicability } = value
  const s = record.snapshot
  const time = (value: string | null | undefined) => {
    if (value == null) return undefined
    const date = new Date(Number(value))
    return Number.isNaN(date.valueOf()) ? undefined : date.toISOString()
  }
  return {
    kind: "twitter",
    id: record.component_id,
    kindId: record.kind_id,
    readStatus: "ready",
    record,
    applicability,
    postId: s.post_id ?? undefined,
    postUrl: s.page_url ?? undefined,
    text: s.text ?? undefined,
    author: s.author
      ? {
          displayName: s.author.display_name ?? undefined,
          handle: s.author.handle ?? undefined,
          userId: s.author.user_id ?? undefined,
          profileUrl: s.author.profile_url ?? undefined,
        }
      : undefined,
    publishedAt: time(s.published_at_unix_ms),
    capturedAt: time(s.observed_at_unix_ms),
    sourceOrder: s.occurrence?.source_order ?? undefined,
    altText: s.occurrence?.alt_text ?? undefined,
    references:
      s.references?.map((r) => ({
        kind: r.kind === "reply_to" ? "reply" : r.kind,
        postId: r.post_id ?? undefined,
        url: r.page_url ?? undefined,
      })) ?? undefined,
  }
}
export function twitterProblems(view: Wire<"TwitterView">, entityId: string): ReadProblem[] {
  const problems: ReadProblem[] = []
  const subject = `Twitter ${view.record.component_id}`
  const add = (key: string, message: string) => problems.push({ key, subject, message, recovery: "entity" })
  for (const [index, issue] of (view.record.snapshot.issues ?? []).entries())
    add(
      `capture:${index}`,
      `Producer reported ${issue.portion.replaceAll("_", " ")}: ${issue.message ?? issue.code} (${issue.code}).`
    )
  const context = view.applicability
  if (context.status === "error") add("context", diagnosticText({ owner: "twitter", error: context.error }))
  if (context.status === "unmounted" && view.record.basis)
    add("association", "The saved Twitter association has no current hosting Entity.")
  if (context.status === "input") {
    if (context.host !== entityId)
      add("host", `The observed Twitter host is Entity ${context.host}; reread this Entity's memberships.`)
    const comparison = context.comparison
    if (comparison.status === "changed")
      add(
        "association",
        `The saved capture is associated with File ${comparison.basis}; current input is File ${comparison.current}.`
      )
    if (comparison.status === "incomplete" && comparison.basis && comparison.current.status !== "file")
      add(
        "association",
        `The saved Twitter association has no current File input (${comparison.current.status.replaceAll("_", " ")}).`
      )
    if (context.file_error) add("file", `Current File: ${context.file_error.message} (${context.file_error.kind}).`)
  }
  return problems
}

export function modelProjection(value: Wire<"ModelView">): EntityComponent {
  return {
    kind: "model",
    id: value.record.component_id,
    kindId: "6c46d4eb-5c2f-46eb-9e81-f866884e3107",
    readStatus: "ready",
    record: value.record,
    applicability: value.applicability,
    host: value.host,
    fileProblem: value.file_problem,
  }
}
export function modelProblems(view: Wire<"ModelView">, entityId: string): ReadProblem[] {
  const subject = `Model ${view.record.component_id}`
  const problems: ReadProblem[] = []
  const add = (key: string, message: string) => problems.push({ key, subject, message, recovery: "entity" })
  if (view.record.last_failure)
    add("inspection", `Last inspection: ${view.record.last_failure.detail} (${view.record.last_failure.code}).`)
  const a = view.applicability
  if (a.status === "changed")
    add("input", `Accepted inspection describes File ${a.basis}; current input is File ${a.current}.`)
  if (a.status === "unmounted") add("context", "Model is no longer attached to an Entity.")
  if (a.status === "error") add("context", diagnosticText(a.diagnostic))
  if (a.status === "incomplete" && a.current.status !== "file")
    add("input", `Current File is unavailable (${a.current.status.replaceAll("_", " ")}).`)
  if (view.host && view.host !== entityId)
    add("host", `Model is now hosted by Entity ${view.host}, not this observed Entity.`)
  if (view.file_problem) add("file", diagnosticText(view.file_problem))
  return problems
}
