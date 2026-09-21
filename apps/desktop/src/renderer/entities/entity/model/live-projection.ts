import type { Wire } from "@/shared/api"
import { diagnosticText } from "@/shared/api"
import type { EntityComponent } from "./entity-item"
import type { ReadProblem } from "./read-problem"

// Assigned owner identities from locus-file/src/identity.rs and
// locus-media/src/identity.rs; labels/type names are not kind authority.
export const supportedKinds = {
  "9fd73d3d-d35d-41bc-8b73-402e12f5c017": "file",
  "aadf84d2-0dc0-4a81-8cdb-901162c78321": "image",
  "f4be9375-60f1-4d04-8f07-8c9ad765e230": "video",
} as const
export function membershipProjection(membership: Wire<"Membership">): EntityComponent {
  const kind =
    (supportedKinds as Record<string, "file" | "image" | "video" | undefined>)[membership.kind_id] ?? "unknown"
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
  const base = { id: record.target.component_id, readStatus: "ready" as const, record, applicability }
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
