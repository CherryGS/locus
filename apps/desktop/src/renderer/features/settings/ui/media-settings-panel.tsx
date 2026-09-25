import { Fragment, useState, useSyncExternalStore } from "react"
import { RotateCcwIcon, SaveIcon, FileSearchIcon, VideoIcon } from "lucide-react"
import { Alert, AlertTitle, AlertDescription } from "@/shared/ui/alert"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { FieldGroup } from "@/shared/ui/field"
import { Separator } from "@/shared/ui/separator"
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
import { mediaPending } from "../model/workspace-status"
import { SettingsGroup, SettingsEditRow } from "./settings-rows"

export function MediaSettingsPanel({ settings }: { settings: SettingsCoordinator }) {
  useSyncExternalStore(settings.subscribe, settings.snapshot)
  const [reset, setReset] = useState<string>()
  const active = settings.runtime?.status === "active" ? settings.runtime.runtime : undefined
  const saved = settings.observation?.status === "current" ? settings.observation.saved : undefined
  const pending = mediaPending(settings)
  return (
    <>
      <section role="region" aria-label="Media settings" className="flex flex-col gap-4">
        {(settings.dirty || pending) && (
          <div className="flex flex-wrap gap-2">
            {settings.dirty && <Badge variant="secondary">Unsaved edits</Badge>}
            {pending && <Badge variant="secondary">Saved · restart required</Badge>}
          </div>
        )}
        <div className="flex flex-col gap-4">
          {(settings.busy || settings.readPending) && (
            <p role="status" className="text-sm text-muted-foreground">
              {settings.busy ? "Saving settings…" : "Reading saved settings…"}
            </p>
          )}
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
            <SettingsGroup name="Media tool paths">
              <FieldGroup className="gap-0">
                {(["ffprobe", "ffmpeg"] as const).map((field) => {
                  const invalid = !!settings.draft && !settings.draft[field].trim()
                  return (
                    <Fragment key={field}>
                      {field === "ffmpeg" && <Separator />}
                      <SettingsEditRow
                        icon={field === "ffprobe" ? <FileSearchIcon /> : <VideoIcon />}
                        label={field}
                        id={`media-${field}`}
                        value={settings.draft?.[field] ?? ""}
                        disabled={!settings.editable}
                        onChange={(event) => settings.edit(field, event.target.value)}
                        hint={
                          field === "ffprobe"
                            ? "Reads duration, dimensions and streams."
                            : "Creates video preview images."
                        }
                        error={invalid ? "Enter an executable name or path." : undefined}
                      />
                    </Fragment>
                  )
                })}
              </FieldGroup>
              {(settings.dirty ||
                settings.busy ||
                settings.attempt ||
                settings.needsEvidence ||
                settings.status === "failed") && (
                <>
                  <Separator />
                  <div className="flex flex-wrap items-center justify-end gap-2 px-4 py-3">
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
                  </div>
                </>
              )}
            </SettingsGroup>
            <p className="mt-2 text-xs text-muted-foreground">
              Enter executable names or full paths. Save and restart to apply.
            </p>
          </form>
          {pending && settings.dirty && saved && !settings.conflict && (
            <p className="break-all text-xs text-muted-foreground">
              Saved for next run: ffprobe {String((saved.value as { ffprobe?: unknown }).ffprobe)} · ffmpeg{" "}
              {String((saved.value as { ffmpeg?: unknown }).ffmpeg)}.
            </p>
          )}
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
          <details
            className="rounded-lg border bg-card"
            key={String(!!pending || !!settings.runtimeError)}
            open={
              pending ||
              !!settings.runtimeError ||
              !!active?.ffprobe.environment ||
              !!active?.ffmpeg.environment ||
              !active ||
              undefined
            }
          >
            <summary className="cursor-pointer px-4 py-3 text-sm">Active in this run</summary>
            <Separator />
            <div className="flex flex-col gap-3 px-4 py-3 text-sm">
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
          </details>
        </div>
        <div className="-ml-2 flex flex-wrap gap-1">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={settings.busy || settings.readPending}
            onClick={() =>
              void (settings.attempt || settings.needsEvidence ? settings.recover() : settings.load())
            }
          >
            Reload / recover
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={
              !settings.resetRevision || settings.busy || !!settings.attempt || settings.needsEvidence
            }
            onClick={() => setReset(settings.resetRevision)}
          >
            <RotateCcwIcon data-icon="inline-start" />
            Reset to defaults
          </Button>
        </div>
      </section>
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
    </>
  )
}
