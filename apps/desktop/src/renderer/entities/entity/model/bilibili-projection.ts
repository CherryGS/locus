import { diagnosticText, errorText, type BackendApi, type Wire } from "@/shared/api"
import type { EntityComponent } from "./entity-item"
import type { ReadProblem } from "./read-problem"
import { mediaProblems } from "./live-projection"
export type BilibiliComponent = Extract<EntityComponent, { kind: "bilibili" }>
export function bilibiliProjection(view: Wire<"BilibiliView">): BilibiliComponent {
  return {
    kind: "bilibili",
    id: view.record.component_id,
    kindId: view.record.kind_id,
    record: view.record,
    view,
    readStatus: "ready",
    cover: { state: view.record.original_cover ? "loading" : "absent" },
  }
}
export function bilibiliProblems(view: Wire<"BilibiliView">, entity: string): ReadProblem[] {
  const problems: ReadProblem[] = []
  const add = (key: string, message: string) =>
    problems.push({ key, subject: "Bilibili capture", message, recovery: "entity" })
  for (const [i, issue] of (view.record.snapshot.issues ?? []).entries())
    add("capture:" + i, "Producer reported " + issue.portion + ": " + (issue.message ?? issue.code))
  const a = view.applicability
  if (a.status === "error") add("association", diagnosticText({ owner: "bilibili", error: a.error }))
  if (a.status === "unmounted") add("association", "Source is not attached to an Entity.")
  if (a.status === "input") {
    if (a.host !== entity) add("host", "The Source is now attached to a different Entity.")
    if (a.comparison.status === "changed")
      add("association", "The local video File differs from this capture's accepted File basis.")
    if (a.comparison.status === "incomplete" && a.comparison.basis)
      add("association", "The accepted local File context is missing.")
    if (a.file_error) add("file", a.file_error.message)
  }
  const c = view.cover
  if (c.status === "error") add("cover-context", c.diagnostic.message)
  if (c.status === "input") {
    if (c.comparison.status === "changed")
      add("cover-context", "The original-cover target File changed; replacement bytes are not adopted.")
    if (c.comparison.status === "incomplete")
      add("cover-context", "The original-cover target Entity or File is missing.")
    if (c.file_error) add("cover-file", c.file_error.message)
  }
  return problems
}
type Api = Pick<BackendApi, "memberships" | "file" | "media"> &
  Partial<Pick<BackendApi, "savedPreview" | "previewBytes">>
export async function readBilibiliCover(
  api: Api,
  view: Wire<"BilibiliView">,
  entity: string,
  blocked?: BilibiliComponent["cover"],
  retryResource = false,
): Promise<{ cover: NonNullable<BilibiliComponent["cover"]>; problems: ReadProblem[]; bytes?: Blob }> {
  const relation = view.record.original_cover
  if (!relation) return { cover: { state: "absent" }, problems: [] }
  const base = { entityId: relation.entity_id, fileId: relation.file_id }
  const retainedFailure =
    blocked?.resourceFailed && blocked.entityId === relation.entity_id && blocked.fileId === relation.file_id
      ? blocked
      : undefined
  let problems: ReadProblem[] =
    blocked?.entityId === relation.entity_id && blocked.fileId === relation.file_id
      ? (blocked.imageProblems ?? [])
      : []
  const retainedProblem = retainedFailure
    ? [
        {
          key: "cover-resource",
          subject: "Original cover",
          message: retainedFailure.message ?? "Previous display access failed.",
          recovery: "resource" as const,
        },
      ]
    : []
  if (
    retainedFailure &&
    (view.cover.status === "error" || (view.cover.status === "input" && view.cover.file_error))
  )
    return { cover: retainedFailure, problems: [...problems, ...retainedProblem] }
  if (
    view.cover.status !== "input" ||
    view.cover.comparison.status !== "matching" ||
    view.cover.comparison.file_id !== relation.file_id ||
    view.cover.file_error
  )
    return {
      cover: {
        ...base,
        state: "unavailable",
        message: "Original-cover context is unavailable. See Overview.",
      },
      problems: [],
    }
  let resourceAttempt = false
  let imageId: string | undefined
  try {
    const memberships = await api.memberships([relation.entity_id])
    const target = memberships[0]
    if (memberships.length !== 1 || target.entity_id !== relation.entity_id || target.status !== "present")
      throw new Error("Original-cover Entity is missing or could not be observed.")
    const file = target.memberships.find((m) => m.kind_id === "9fd73d3d-d35d-41bc-8b73-402e12f5c017")
    if (file?.component_id !== relation.file_id) throw new Error("Original-cover File membership changed.")
    const actual = await api.file(relation.file_id)
    if (actual.file_id !== relation.file_id) throw new Error("Cover File read returned a different identity.")
    const image = target.memberships.find((m) => m.kind_id === "aadf84d2-0dc0-4a81-8cdb-901162c78321")
    if (!image)
      return {
        cover: {
          ...base,
          state: "unavailable",
          message: "No Image component is established for the original cover.",
        },
        problems: [],
      }
    imageId = image.component_id
    const media = await api.media("image", image.component_id)
    if (media.record.target.component_id !== image.component_id || media.record.target.kind !== "image")
      throw new Error("Original-cover Image read returned a different identity.")
    problems = mediaProblems(media).map((p) => ({
      ...p,
      key: "cover-image:" + p.key,
      subject: "Original cover · " + p.subject,
    }))
    // Saved preview resolves its own actual current input. Retained interpretation
    // diagnostics do not veto an independently applicable existing representation.
    if (retainedFailure && retainedFailure.imageId === image.component_id && !retryResource)
      return {
        cover: { ...retainedFailure, imageProblems: problems },
        problems: [...problems, ...retainedProblem],
      }
    const output = await api.savedPreview?.("image", image.component_id)
    if (!output && retainedFailure && retainedFailure.imageId === image.component_id)
      return {
        cover: { ...retainedFailure, imageProblems: problems },
        problems: [...problems, ...retainedProblem],
      }
    if (!output)
      return {
        cover: {
          ...base,
          imageId: image.component_id,
          state: "unavailable",
          message: "No existing Image preview is available.",
        },
        problems,
      }
    if (output.kind !== "image" || output.file_id !== relation.file_id)
      throw new Error("Original-cover preview belongs to a different input.")
    if (!api.previewBytes) throw new Error("Original-cover resource access is unavailable.")
    resourceAttempt = true
    const bytes = await api.previewBytes(output.locator, new AbortController().signal)
    if (typeof createImageBitmap === "function") {
      const decoded = await createImageBitmap(bytes)
      decoded.close()
    }
    const current = await api.memberships([relation.entity_id])
    if (
      current.length !== 1 ||
      current[0].entity_id !== relation.entity_id ||
      current[0].status !== "present" ||
      !current[0].memberships.some(
        (m) => m.kind_id === file.kind_id && m.component_id === relation.file_id,
      ) ||
      !current[0].memberships.some(
        (m) => m.kind_id === image.kind_id && m.component_id === image.component_id,
      )
    )
      throw new Error("Original-cover membership changed while loading.")
    const a = view.applicability
    return {
      cover: {
        ...base,
        imageId: image.component_id,
        state: "available",
        imageProblems: problems,
        forVideo:
          a.status === "input" && a.host === entity && a.comparison.status === "matching" && !a.file_error,
      },
      problems,
      bytes,
    }
  } catch (error) {
    const message = errorText(error)
    if (retainedFailure && !resourceAttempt)
      return {
        cover: { ...retainedFailure, imageProblems: problems },
        problems: [
          ...problems,
          ...retainedProblem,
          { key: "cover-observation", subject: "Original cover context", message, recovery: "entity" },
        ],
      }
    return {
      cover: {
        ...base,
        imageId,
        state: "failed",
        message,
        resourceFailed: resourceAttempt,
        imageProblems: problems,
      },
      problems: [
        ...problems,
        {
          key: "cover-resource",
          subject: "Original cover",
          message,
          recovery: resourceAttempt ? "resource" : "entity",
        },
      ],
    }
  }
}
