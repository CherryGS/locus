import { Fragment, useState, useSyncExternalStore } from "react"
import { RotateCcwIcon, RefreshCwIcon, SaveIcon, FileSearchIcon, VideoIcon } from "lucide-react"
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
            <SettingsGroup
              name="Tool paths"
              description="Executable names or full paths. Save and restart to apply."
              action={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Reload / recover"
                  title="Reload / recover"
                  disabled={settings.busy || settings.readPending}
                  onClick={() =>
                    void (settings.attempt || settings.needsEvidence ? settings.recover() : settings.load())
                  }
                >
                  <RefreshCwIcon />
                </Button>
              }
              footer={
                <>
                  <Button
                    type="button"
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
                  {(settings.dirty ||
                    settings.busy ||
                    settings.attempt ||
                    settings.needsEvidence ||
                    settings.status === "failed") && (
                    <div className="ml-auto flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        type="submit"
                        disabled={
                          !settings.canSave ||
                          !settings.draft?.ffprobe.trim() ||
                          !settings.draft.ffmpeg.trim()
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
                        size="sm"
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
                  )}
                </>
              }
            >
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
                      {active && (
                        <dl className="flex min-w-0 flex-col gap-1 px-4 pb-4 pl-14">
                          <dt className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {settings.runtimeError ? "Last confirmed path" : "Active in this run"}
                            {active[field].environment && (
                              <Badge variant="outline">{active[field].environment}</Badge>
                            )}
                          </dt>
                          <dd className="break-all font-mono text-xs">{active[field].path}</dd>
                        </dl>
                      )}
                    </Fragment>
                  )
                })}
              </FieldGroup>
              {(settings.runtimeError ||
                !active ||
                active.ffprobe.environment ||
                active.ffmpeg.environment) && (
                <div className="flex flex-col gap-3 px-4 pb-4 text-xs text-muted-foreground">
                  {settings.runtimeError && (
                    <Alert variant="destructive">
                      <AlertDescription>
                        {settings.runtimeError}
                        {active ? " Displaying the last confirmed runtime observation." : ""}
                      </AlertDescription>
                    </Alert>
                  )}
                  {!active ? (
                    <p>
                      {settings.runtimeError
                        ? "The current runtime configuration could not be confirmed."
                        : settings.runtime?.status === "unavailable"
                          ? "Media did not start; active tool paths are unavailable."
                          : "Reading the current runtime configuration…"}
                    </p>
                  ) : active.ffprobe.environment || active.ffmpeg.environment ? (
                    <p className="leading-relaxed">
                      Environment variables override saved paths, including after restart. Unset them to use
                      your saved settings.
                    </p>
                  ) : null}
                </div>
              )}
            </SettingsGroup>
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
