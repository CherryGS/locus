import type { Wire } from "@/shared/api"
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object"
const id = (value: unknown): value is string => typeof value === "string" && value.length > 0
function target(value: unknown) {
  return object(value) && ["image", "video"].includes(String(value.kind)) && id(value.component_id)
}
function operation(value: unknown): value is Wire<"TaskOperation"> {
  if (!object(value)) return false
  switch (value.kind) {
    case "civitai":
      return id(value.entity_id) && id(value.operation_id)
    case "upload":
      return (
        id(value.upload_id) &&
        typeof value.byte_count === "string" &&
        /^\d+$/.test(value.byte_count) &&
        (value.filename === null || typeof value.filename === "string")
      )
    case "upload_recovery":
      return id(value.upload_id)
    case "import_batch":
      return id(value.batch_id) && Number.isSafeInteger(value.item_count) && Number(value.item_count) > 0
    case "import_recovery":
      return id(value.batch_id) && id(value.item_id)
    case "file_import":
      return id(value.source_path)
    case "interpretation":
      return target(value.target)
    case "preview":
      return target(value.target) && Number.isSafeInteger(value.edge) && Number(value.edge) > 0
    default:
      return false
  }
}
export function validTask(value: unknown): value is Wire<"PublicTask"> {
  return (
    object(value) &&
    id(value.task_id) &&
    id(value.request_id) &&
    ["desktop", "external"].includes(String(value.access_context)) &&
    typeof value.label === "string" &&
    operation(value.operation) &&
    ["submitted", "waiting", "running", "between_stages", "terminal"].includes(String(value.state)) &&
    [value.stage, value.message].every((field) => field === null || typeof field === "string") &&
    [value.completed, value.total].every(
      (field) => field === null || (typeof field === "string" && /^\d+$/.test(field)),
    ) &&
    typeof value.outcome_available === "boolean"
  )
}

/** Validate only the generated projection we retain and present. These guards
 * establish observation availability; they never reinterpret domain success. */
export function validOutcome(value: unknown): value is Wire<"TaskOutcome"> {
  if (!object(value)) return false
  switch (value.status) {
    case "civitai":
      return (
        id(value.operation_id) &&
        (value.result === null ||
          (object(value.result) &&
            id(value.result.entity_id) &&
            id(value.result.file_id) &&
            typeof value.result.state === "string"))
      )
    case "upload":
      return (
        object(value.result) &&
        id(value.result.upload_id) &&
        typeof value.result.byte_count === "string" &&
        typeof value.result.uncertain === "boolean" &&
        Array.isArray(value.result.actions) &&
        (value.result.confirmed_file_id === null || id(value.result.confirmed_file_id))
      )
    case "import_batch":
      return id(value.batch_id)
    case "import_recovery":
      return id(value.batch_id) && id(value.item_id)
    case "failed":
      return (
        object(value.diagnostic) &&
        typeof value.diagnostic.message === "string" &&
        (value.progress === null ||
          (object(value.progress) &&
            id(value.progress.file_id) &&
            typeof value.progress.bytes_written === "string"))
      )
    case "media_failed":
      return object(value.diagnostic) && typeof value.diagnostic.owner === "string"
    case "imported":
      return (
        object(value.file) &&
        id(value.file.file_id) &&
        id(value.file.kind_id) &&
        typeof value.file.byte_count === "string" &&
        /^\d+$/.test(value.file.byte_count) &&
        typeof value.file.relative_path === "string"
      )
    case "preview":
      return (
        object(value.preview) &&
        id(value.preview.locator) &&
        id(value.preview.file_id) &&
        ["image", "video"].includes(String(value.preview.kind)) &&
        Number.isSafeInteger(value.preview.edge) &&
        Number(value.preview.edge) > 0 &&
        ["hit", "generated"].includes(String(value.preview.origin))
      )
    case "interpreted": {
      if (!object(value.result)) return false
      if (
        value.result.status === "rejected_context_changed" ||
        value.result.status === "rejected_newer_attempt"
      )
        return true
      const record = value.result.record
      return (
        value.result.status === "accepted" &&
        object(record) &&
        target(record.target) &&
        typeof record.revision === "string" &&
        (record.last_failure === null ||
          (object(record.last_failure) &&
            typeof record.last_failure.code === "string" &&
            typeof record.last_failure.detail === "string"))
      )
    }
    default:
      return false
  }
}
