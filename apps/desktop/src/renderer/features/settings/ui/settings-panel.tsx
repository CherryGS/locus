import { useEffect, useState, useSyncExternalStore } from "react"
import { RotateCcwIcon, RotateCwIcon, SaveIcon } from "lucide-react"
import { Alert, AlertTitle, AlertDescription } from "@/shared/ui/alert"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/shared/ui/card"
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldError } from "@/shared/ui/field"
import { Input } from "@/shared/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/shared/ui/dialog"
import { Spinner } from "@/shared/ui/spinner"
import type { SettingsCoordinator } from "../model/settings-coordinator"
import { ExternalAccessPanel } from "./external-access-panel"
import type { externalAddressSettings, ExternalTokenCoordinator } from "../model/external-access"

export function SettingsPanel({
  settings,
  restart,
  restricted,
  externalSettings,
  externalToken,
}: {
  settings: SettingsCoordinator
  restart: () => Promise<void>
  restricted?: string
  externalSettings: ReturnType<typeof externalAddressSettings>
  externalToken: ExternalTokenCoordinator
}) {
  useSyncExternalStore(settings.subscribe, settings.snapshot)
  const [reset, setReset] = useState<string>()
  const [hostError, setHostError] = useState<string>()
  useEffect(() => {
    void settings.load()
  }, [settings])
  const active = settings.runtime?.status === "active" ? settings.runtime.runtime : undefined
  const saved = settings.observation?.status === "current" ? settings.observation.saved : undefined
  const pending = !!saved && !!active && active.captured.metadata.revision !== saved.metadata.revision
  const doRestart = () => {
    setHostError(undefined)
    void restart().catch((error) =>
      setHostError(error instanceof Error ? error.message : "Restart unavailable")
    )
  }
  return (
    <section className="h-full overflow-auto p-4 sm:p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
            <p className="mt-1 text-sm text-muted-foreground">Configuration saved in this library.</p>
          </div>
          <Button variant="outline" onClick={doRestart}>
            <RotateCwIcon data-icon="inline-start" />
            {restricted ? "Retry application" : "Restart application"}
          </Button>
        </header>
        {restricted && (
          <Alert variant="destructive">
            <AlertTitle>Library needs attention</AlertTitle>
            <AlertDescription>
              {restricted} Review the reported cause and available settings, then explicitly retry the
              application. Saving alone does not start library services.
            </AlertDescription>
          </Alert>
        )}
        {hostError && (
          <Alert variant="destructive">
            <AlertDescription>{hostError}</AlertDescription>
          </Alert>
        )}
        <ExternalAccessPanel settings={externalSettings} token={externalToken} restricted={restricted} />
        <Card role="region" aria-label="Media settings">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle>Media</CardTitle>
              <Badge variant="secondary">
                {settings.dirty
                  ? "Unsaved edits"
                  : pending
                    ? "Saved · restart required"
                    : saved
                      ? "Saved"
                      : "Saved values unavailable"}
              </Badge>
            </div>
            <CardDescription>
              Tools used to inspect videos and create still previews. Enter an executable name or a full path.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
              {settings.busy
                ? "Saving settings…"
                : settings.readPending
                  ? "Reading saved settings…"
                  : settings.status === "saved"
                    ? "Settings saved. Runtime values change after a full application restart."
                    : "Changes are saved only when you choose Save."}
            </div>
            {settings.definitionError && (
              <Alert variant="destructive">
                <AlertTitle>Settings definition unavailable</AlertTitle>
                <AlertDescription>
                  {settings.definitionError} Reset is unavailable until the definition can be read.
                </AlertDescription>
              </Alert>
            )}
            {(settings.readError || settings.problem) && (
              <Alert variant="destructive">
                <AlertTitle>
                  {settings.status === "uncertain" ? "Save not confirmed" : "Settings need attention"}
                </AlertTitle>
                <AlertDescription>{settings.readError ?? settings.problem}</AlertDescription>
              </Alert>
            )}
            {settings.observation && settings.observation.status !== "current" && (
              <Alert>
                <AlertTitle>Saved value unavailable</AlertTitle>
                <AlertDescription>
                  {"message" in settings.observation
                    ? settings.observation.message
                    : `Observation: ${settings.observation.status.replaceAll("_", " ")}.`}{" "}
                  Reset requires an observed revision and the current version’s definition.
                </AlertDescription>
              </Alert>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void settings.save()
              }}
            >
              <FieldGroup>
                {(["ffprobe", "ffmpeg"] as const).map((field) => {
                  const invalid = !!settings.draft && !settings.draft[field].trim()
                  return (
                    <Field key={field} data-invalid={invalid} data-disabled={!settings.editable}>
                      <FieldLabel htmlFor={`media-${field}`}>{field}</FieldLabel>
                      <Input
                        id={`media-${field}`}
                        value={settings.draft?.[field] ?? ""}
                        disabled={!settings.editable}
                        aria-invalid={invalid}
                        aria-describedby={`media-${field}-help`}
                        onChange={(event) => settings.edit(field, event.target.value)}
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <FieldDescription id={`media-${field}-help`}>
                        {field === "ffprobe"
                          ? "Reads video duration, dimensions and stream information."
                          : "Creates still preview images from video."}
                      </FieldDescription>
                      {invalid && <FieldError>Enter an executable name or path.</FieldError>}
                    </Field>
                  )
                })}
              </FieldGroup>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button
                  type="submit"
                  disabled={
                    !settings.canSave || !settings.draft?.ffprobe.trim() || !settings.draft.ffmpeg.trim()
                  }
                >
                  {settings.busy ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <SaveIcon data-icon="inline-start" />
                  )}
                  Save
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={
                    !saved ||
                    settings.busy ||
                    !!settings.attempt ||
                    settings.needsEvidence ||
                    (!settings.dirty && settings.status !== "failed")
                  }
                  onClick={() => settings.discard()}
                >
                  Discard edits
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={settings.busy || settings.readPending}
                  onClick={() =>
                    void (settings.attempt || settings.needsEvidence ? settings.recover() : settings.load())
                  }
                >
                  Reload / recover
                </Button>
              </div>
            </form>
            {settings.conflict && saved && (
              <Alert>
                <AlertTitle>Current saved values</AlertTitle>
                <AlertDescription>
                  <span className="break-all">
                    ffprobe: {String((saved.value as { ffprobe?: unknown }).ffprobe)} · ffmpeg:{" "}
                    {String((saved.value as { ffmpeg?: unknown }).ffmpeg)}
                  </span>
                </AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-2 text-sm">
              <h2 className="font-medium">Active in this run</h2>
              {settings.runtimeError && (
                <Alert variant="destructive">
                  <AlertDescription>
                    {settings.runtimeError}
                    {active ? " Displaying the last confirmed runtime observation." : ""}
                  </AlertDescription>
                </Alert>
              )}
              {active ? (
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2">
                  {(["ffprobe", "ffmpeg"] as const).map((field) => (
                    <div key={field} className="contents">
                      <dt className="text-muted-foreground">{field}</dt>
                      <dd className="break-all">
                        {active[field].path}
                        <p className="text-xs text-muted-foreground">
                          {active[field].environment
                            ? `Overridden by ${active[field].environment}. Restart keeps this override while the environment variable is set.`
                            : "Captured from saved library settings at startup."}
                        </p>
                      </dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="text-muted-foreground">
                  {settings.runtimeError
                    ? "The current runtime configuration could not be confirmed."
                    : settings.runtime?.status === "unavailable"
                      ? "Media did not start; active tool paths are unavailable."
                      : "Reading the current runtime configuration…"}
                </p>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex flex-wrap justify-between gap-3">
            <p className="text-xs text-muted-foreground">Reset uses the current version’s defaults.</p>
            <Button
              variant="outline"
              disabled={
                !settings.resetRevision || settings.busy || !!settings.attempt || settings.needsEvidence
              }
              onClick={() => setReset(settings.resetRevision)}
            >
              <RotateCcwIcon data-icon="inline-start" />
              Reset to defaults
            </Button>
          </CardFooter>
        </Card>
        <Dialog
          open={!!reset}
          onOpenChange={(open) => {
            if (!open) setReset(undefined)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reset Media settings?</DialogTitle>
              <DialogDescription>
                This replaces the observed saved group with current defaults: ffprobe “
                {settings.defaults.ffprobe}”, ffmpeg “{settings.defaults.ffmpeg}”. A restart is required to
                apply them.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReset(undefined)}>
                Cancel
              </Button>
              <Button
                disabled={reset !== settings.resetRevision}
                onClick={() => {
                  if (reset === settings.resetRevision) void settings.reset()
                  setReset(undefined)
                }}
              >
                Confirm reset
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </section>
  )
}
