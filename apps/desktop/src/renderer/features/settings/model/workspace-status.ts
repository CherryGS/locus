import type { SettingsCoordinator } from "./settings-coordinator"
import type { ExternalTokenCoordinator, externalAddressSettings } from "./external-access"

export function mediaPending(settings: SettingsCoordinator) {
  return (
    settings.observation?.status === "current" &&
    settings.runtime?.status === "active" &&
    settings.observation.saved.metadata.revision !== settings.runtime.runtime.captured.metadata.revision
  )
}
export function addressPending(settings: ReturnType<typeof externalAddressSettings>) {
  return (
    settings.observation?.status === "current" &&
    !!settings.runtime?.captured &&
    settings.observation.saved.metadata.revision !== settings.runtime.captured.metadata.revision
  )
}
export function groupStatus(
  settings: Pick<
    SettingsCoordinator,
    | "dirty"
    | "busy"
    | "attempt"
    | "needsEvidence"
    | "readError"
    | "definitionError"
    | "runtimeError"
    | "problem"
    | "observation"
  >,
  pending: boolean,
) {
  return [
    settings.dirty && "Unsaved edits",
    pending && "Restart required",
    settings.busy && "Saving",
    (settings.attempt ||
      settings.needsEvidence ||
      settings.readError ||
      settings.definitionError ||
      settings.runtimeError ||
      settings.problem ||
      (settings.observation && settings.observation.status !== "current")) &&
      "Needs attention",
  ]
    .filter(Boolean)
    .join(" · ")
}
export function externalStatus(
  settings: ReturnType<typeof externalAddressSettings>,
  token: ExternalTokenCoordinator,
) {
  return [
    groupStatus(settings, addressPending(settings)),
    token.pending ? "Token pending" : token.attempt || token.problem ? "Token needs attention" : "",
    settings.runtime?.problem ? "Entry unavailable" : "",
  ]
    .filter(Boolean)
    .join(" · ")
}
