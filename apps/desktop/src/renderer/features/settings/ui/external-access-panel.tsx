import { useEffect, useState, useSyncExternalStore } from "react"
import {
  CopyIcon,
  EyeIcon,
  EyeOffIcon,
  KeyRoundIcon,
  RotateCcwIcon,
  RefreshCwIcon,
  SaveIcon,
  LinkIcon,
  RadioIcon,
} from "lucide-react"
import { Alert, AlertTitle, AlertDescription } from "@/shared/ui/alert"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { Separator } from "@/shared/ui/separator"
import { SettingsGroup, SettingsEditRow, SettingsRow, IconTile } from "./settings-rows"
import { Field, FieldGroup, FieldLabel } from "@/shared/ui/field"
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
  const [addressFeedback, setAddressFeedback] = useState<string>()
  const [tokenFeedback, setTokenFeedback] = useState<string>()
  const saved = settings.observation?.status === "current" ? settings.observation.saved : undefined
  const runtime = settings.runtime
  const pending =
    !!saved && !!runtime?.captured && saved.metadata.revision !== runtime.captured.metadata.revision
  const current = token.current
  const reveal = !!current && current.revision === revealedRevision
  const addressEmpty = !!settings.draft && !settings.draft.address.trim()
  useEffect(() => {
    setRevealedRevision(undefined)
    setTokenFeedback(undefined)
  }, [current?.revision])
  const copyAddress = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setAddressFeedback("Address copied.")
    } catch {
      setAddressFeedback("Address could not be copied. Select the address to copy it manually.")
    }
  }
  const copyToken = async () => {
    const value = token.current
    if (!value) return
    try {
      await navigator.clipboard.writeText(value.token)
      setTokenFeedback(
        token.current?.revision === value.revision
          ? "Token copied."
          : "The Token observation changed while copying. Read and copy the current Token again.",
      )
    } catch {
      setTokenFeedback("Token could not be copied. Reveal it to copy manually.")
    }
  }
  return (
    <>
      <section role="region" aria-label="External connection" className="flex flex-col gap-4">
        {(settings.dirty || pending) && (
          <div className="flex flex-wrap gap-2">
            {settings.dirty && <Badge variant="secondary">Unsaved edits</Badge>}
            {pending && <Badge variant="secondary">Saved · restart required</Badge>}
          </div>
        )}
        <div className="flex flex-col gap-4">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void settings.save()
            }}
          >
            <SettingsGroup
              name="Connection address"
              action={
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Reload / recover address"
                  title="Reload / recover address"
                  disabled={settings.busy || settings.readPending}
                  onClick={() =>
                    void (settings.attempt || settings.needsEvidence ? settings.recover() : settings.load())
                  }
                >
                  <RefreshCwIcon data-icon="inline-start" />
                </Button>
              }
              footer={
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    title="Restores only the address; the shared Token is unchanged."
                    disabled={
                      !settings.resetRevision || settings.busy || !!settings.attempt || settings.needsEvidence
                    }
                    onClick={() => void settings.reset()}
                  >
                    <RotateCcwIcon data-icon="inline-start" />
                    Restore default address
                  </Button>
                  {(settings.dirty ||
                    settings.busy ||
                    settings.attempt ||
                    settings.needsEvidence ||
                    settings.status === "failed") && (
                    <div className="ml-auto flex flex-wrap items-center gap-2">
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
                    </div>
                  )}
                </>
              }
            >
              <SettingsRow
                icon={<RadioIcon />}
                label="Active in this run"
                hint="Copy this address to your extension."
              >
                {runtime?.active_address && !settings.runtimeError ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="break-all">{`http://${runtime.active_address}`}</code>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void copyAddress(`http://${runtime.active_address}`)}
                    >
                      <CopyIcon data-icon="inline-start" />
                      Copy address
                    </Button>
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
              {(addressFeedback || runtime?.override_address || runtime?.problem) && (
                <div className="flex flex-col gap-2 px-4 pb-3 text-xs">
                  {addressFeedback && (
                    <p role="status" className="text-muted-foreground">
                      {addressFeedback}
                    </p>
                  )}
                  {runtime?.override_address && (
                    <p className="text-muted-foreground">
                      This run uses an explicit test address override. It does not apply the saved address.
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
              <FieldGroup className="gap-0">
                <SettingsEditRow
                  icon={<LinkIcon />}
                  label="Saved address"
                  id="external-address"
                  value={settings.draft?.address ?? ""}
                  placeholder={settings.defaults.address}
                  disabled={!settings.editable}
                  hint="Loopback IP and port. Save and restart to apply."
                  error={addressEmpty ? "Enter a loopback address and port." : undefined}
                  onChange={(event) => settings.edit("address", event.target.value)}
                />
              </FieldGroup>
            </SettingsGroup>
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
              <AlertDescription>{String((saved.value as { address?: unknown }).address)}</AlertDescription>
            </Alert>
          )}
        </div>
      </section>
      <section role="region" aria-label="Shared Token" className="flex flex-col gap-4">
        <SettingsGroup
          name="Access token"
          description="Allows connected clients to upload files, import content and read results."
          action={
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
          }
          footer={
            <>
              <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                Reset invalidates the old Token. Update it in every connected client.
              </p>
              <Button
                variant="outline"
                size="sm"
                disabled={!current || !!restricted}
                onClick={() => {
                  setRevealedRevision(undefined)
                  setTokenFeedback(undefined)
                  void token.reset()
                }}
              >
                <KeyRoundIcon data-icon="inline-start" />
                Reset shared Token
              </Button>
            </>
          }
        >
          <FieldGroup className="gap-0">
            <Field orientation="responsive" className="min-h-16 items-center gap-3 px-4 py-3">
              <div className="flex flex-1 items-center gap-3">
                <IconTile>
                  <KeyRoundIcon />
                </IconTile>
                <div className="flex flex-col gap-0.5">
                  <FieldLabel htmlFor="external-token">Current Token</FieldLabel>
                  <p className="text-xs text-muted-foreground">Shared by all external clients.</p>
                </div>
              </div>
              <div className="flex min-w-0 flex-wrap items-center gap-1">
                <Input
                  id="external-token"
                  type={reveal && current ? "text" : "password"}
                  value={current?.token ?? ""}
                  readOnly
                  autoComplete="off"
                  spellCheck={false}
                  className="w-44 max-w-full"
                  placeholder={token.pending ? "Reading or replacing Token…" : "Current Token unavailable"}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={reveal ? "Hide Token" : "Reveal Token"}
                  title={reveal ? "Hide Token" : "Reveal Token"}
                  disabled={!current || !!restricted}
                  onClick={() => {
                    setRevealedRevision(reveal ? undefined : current?.revision)
                    setTokenFeedback(reveal ? "Token hidden." : "Token revealed locally.")
                  }}
                >
                  {reveal ? <EyeOffIcon data-icon="inline-start" /> : <EyeIcon data-icon="inline-start" />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Copy Token"
                  title="Copy Token"
                  disabled={!current || !!restricted}
                  onClick={() => void copyToken()}
                >
                  <CopyIcon data-icon="inline-start" />
                </Button>
              </div>
            </Field>
          </FieldGroup>
        </SettingsGroup>
        {(token.problem || restricted || token.pending || token.feedback || tokenFeedback) && (
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
            {tokenFeedback && (
              <p role="status" className="text-sm text-muted-foreground">
                {tokenFeedback}
              </p>
            )}
          </div>
        )}
      </section>
    </>
  )
}
