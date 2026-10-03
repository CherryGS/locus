import { useEffect, useState, useSyncExternalStore } from "react"
import {
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  RotateCcwIcon,
  RefreshCwIcon,
  SaveIcon,
} from "lucide-react"
import { Alert, AlertTitle, AlertDescription } from "@/shared/ui/alert"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { Separator } from "@/shared/ui/separator"
import { SettingsActions, SettingsGroup, SettingsEditRow, SettingsRow } from "./settings-rows"
import { FieldGroup } from "@/shared/ui/field"
import { Input } from "@/shared/ui/input"
import type { externalAddressSettings, ExternalTokenCoordinator } from "../model/external-access"

export function ExternalAccessPanel({
  settings,
  token,
  restricted,
}: {
  settings: ReturnType<typeof externalAddressSettings>
  token: ExternalTokenCoordinator
  restricted?: string
}) {
  useSyncExternalStore(settings.subscribe, settings.snapshot)
  useSyncExternalStore(token.subscribe, token.snapshot)
  const [revealedRevision, setRevealedRevision] = useState<string>()
  const saved = settings.observation?.status === "current" ? settings.observation.saved : undefined
  const runtime = settings.runtime
  const pending =
    !!saved && !!runtime?.captured && saved.metadata.revision !== runtime.captured.metadata.revision
  const current = token.current
  const reveal = !!current && current.revision === revealedRevision
  const addressEmpty = !!settings.draft && !settings.draft.address.trim()
  const showActions =
    settings.dirty ||
    settings.busy ||
    settings.attempt ||
    settings.needsEvidence ||
    settings.status === "failed"
  useEffect(() => {
    setRevealedRevision(undefined)
  }, [current?.revision])
  return (
    <section role="region" aria-label="External connection" className="flex flex-col gap-5">
      <SettingsGroup
        name="Connection details"
        help={{
          label: "About external connection",
          content: <p>Use this address and shared Token in your connected clients.</p>,
        }}
        status={
          runtime?.active_address && !settings.runtimeError && !runtime.problem ? (
            <Badge variant="outline">Listening</Badge>
          ) : undefined
        }
      >
        <SettingsRow label="Current address">
          {runtime?.active_address && !settings.runtimeError ? (
            <div className="flex min-h-8 min-w-0 flex-wrap items-center justify-between gap-1">
              <code className="break-all">{`http://${runtime.active_address}`}</code>
            </div>
          ) : (
            <p className="text-muted-foreground">
              {settings.runtimeError ??
                (runtime?.problem
                  ? "The configured address is not listening."
                  : "Reading the external listener state…")}
            </p>
          )}
        </SettingsRow>
        {(runtime?.override_address || runtime?.problem) && (
          <div className="flex flex-col gap-2 px-4 pb-3 text-xs">
            {runtime?.override_address && (
              <p className="text-muted-foreground">
                This run uses an explicit test address override. It does not apply the saved
                address.
              </p>
            )}
            {runtime?.problem && (
              <Alert variant="destructive">
                <AlertTitle>External entry unavailable</AlertTitle>
                <AlertDescription>
                  {runtime.problem}{" "}
                  {restricted
                    ? "Repair required configuration, then retry the application."
                    : "Browsing and local import remain available. Save a corrected address and restart when ready."}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <Separator />
        <section role="region" aria-label="Shared Token">
          <SettingsRow label="Current Token" htmlFor="external-token">
            <div className="flex min-w-0 items-center gap-1">
              <Input
                id="external-token"
                type={reveal && current ? "text" : "password"}
                value={current?.token ?? ""}
                readOnly
                autoComplete="off"
                spellCheck={false}
                className="min-w-0 flex-1"
                placeholder={
                  token.pending ? "Reading or replacing Token…" : "Current Token unavailable"
                }
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={reveal ? "Hide Token" : "Reveal Token"}
                title={reveal ? "Hide Token" : "Reveal Token"}
                disabled={!current || !!restricted}
                onClick={() => {
                  setRevealedRevision(reveal ? undefined : current?.revision)
                }}
              >
                {reveal ? (
                  <EyeOffIcon data-icon="inline-start" />
                ) : (
                  <EyeIcon data-icon="inline-start" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={token.attempt ? "Recover Token reset" : "Read current Token"}
                title={token.attempt ? "Recover Token reset" : "Read current Token"}
                disabled={token.pending || !!restricted}
                onClick={() => void token.recover()}
              >
                <RefreshCwIcon data-icon="inline-start" />
              </Button>
            </div>
            {(token.problem || restricted || token.pending || token.feedback) && (
              <div className="flex flex-col gap-3">
                {token.problem && (
                  <Alert variant="destructive">
                    <AlertTitle>
                      {token.attempt ? "Reset not confirmed" : "Token observation unavailable"}
                    </AlertTitle>
                    <AlertDescription>{token.problem}</AlertDescription>
                  </Alert>
                )}
                {restricted && (
                  <Alert>
                    <AlertDescription>
                      Token creation and reset are unavailable during Settings repair.
                    </AlertDescription>
                  </Alert>
                )}
                {(token.pending || token.feedback) && (
                  <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
                    {token.pending ? "Waiting for the access operation…" : token.feedback}
                  </p>
                )}
              </div>
            )}
          </SettingsRow>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 pb-3">
            <p className="min-w-48 flex-1 text-xs leading-5 text-muted-foreground">
              Reset invalidates the old Token. Update it in every connected client.
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={!current || !!restricted}
              onClick={() => {
                setRevealedRevision(undefined)
                void token.reset()
              }}
            >
              <KeyRoundIcon data-icon="inline-start" />
              Reset shared Token
            </Button>
          </div>
        </section>
      </SettingsGroup>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void settings.save()
        }}
      >
        <SettingsGroup
          name="Listener settings"
          help={{
            label: "About listener settings",
            content: (
              <p>
                Enter a loopback IP and port. Saved changes apply after restart. Restoring the
                default address leaves the shared Token unchanged.
              </p>
            ),
          }}
          action={
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Restore default address"
                title="Restores only the address; the shared Token is unchanged."
                disabled={
                  !settings.resetRevision ||
                  settings.busy ||
                  !!settings.attempt ||
                  settings.needsEvidence
                }
                onClick={() => void settings.reset()}
              >
                <RotateCcwIcon data-icon="inline-start" />
                Restore defaults
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Reload / recover address"
                title="Reload / recover address"
                disabled={settings.busy || settings.readPending}
                onClick={() =>
                  void (settings.attempt || settings.needsEvidence
                    ? settings.recover()
                    : settings.load())
                }
              >
                <RefreshCwIcon data-icon="inline-start" />
              </Button>
            </>
          }
        >
          <FieldGroup className="gap-0">
            <SettingsEditRow
              label="Saved address"
              id="external-address"
              value={settings.draft?.address ?? ""}
              placeholder={settings.defaults.address}
              disabled={!settings.editable}
              error={addressEmpty ? "Enter a loopback address and port." : undefined}
              onChange={(event) => settings.edit("address", event.target.value)}
            />
          </FieldGroup>
        </SettingsGroup>
        {(showActions || pending) && (
          <SettingsActions
            notice={settings.dirty ? "Unsaved edits · applies after restart" : undefined}
            status={pending && <Badge variant="secondary">Saved · restart required</Badge>}
          >
            {showActions && (
              <>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    !saved ||
                    settings.busy ||
                    !!settings.attempt ||
                    settings.needsEvidence ||
                    (!settings.dirty && settings.status !== "failed")
                  }
                  onClick={() => settings.discard()}
                >
                  Discard address edits
                </Button>
                <Button type="submit" size="sm" disabled={!settings.canSave || addressEmpty}>
                  <SaveIcon data-icon="inline-start" />
                  Save address
                </Button>
              </>
            )}
          </SettingsActions>
        )}
      </form>
      {(settings.busy || settings.readPending) && (
        <p role="status" className="text-sm text-muted-foreground">
          {settings.busy ? "Saving address…" : "Reading saved address…"}
        </p>
      )}
      {(settings.readError || settings.problem || settings.definitionError) && (
        <Alert variant="destructive">
          <AlertTitle>Address settings need attention</AlertTitle>
          <AlertDescription>
            {settings.readError ?? settings.problem ?? settings.definitionError}
          </AlertDescription>
        </Alert>
      )}
      {settings.observation && settings.observation.status !== "current" && (
        <Alert>
          <AlertTitle>Saved address unavailable</AlertTitle>
          <AlertDescription>
            {"message" in settings.observation
              ? settings.observation.message
              : `Observed ${settings.observation.status.replaceAll("_", " ")}.`}{" "}
            Restore defaults only with the current observed revision.
          </AlertDescription>
        </Alert>
      )}
      {pending && settings.dirty && saved && !settings.conflict && (
        <p className="break-all text-xs text-muted-foreground">
          Saved for next run: {String((saved.value as { address?: unknown }).address)}.
        </p>
      )}
      {settings.conflict && saved && (
        <Alert>
          <AlertTitle>Current saved address</AlertTitle>
          <AlertDescription>
            {String((saved.value as { address?: unknown }).address)}
          </AlertDescription>
        </Alert>
      )}
    </section>
  )
}
