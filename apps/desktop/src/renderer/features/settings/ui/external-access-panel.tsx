import { useEffect, useState, useSyncExternalStore } from "react"
import { CopyIcon, EyeIcon, EyeOffIcon, KeyRoundIcon, RotateCcwIcon, SaveIcon } from "lucide-react"
import { Alert, AlertTitle, AlertDescription } from "@/shared/ui/alert"
import { Badge } from "@/shared/ui/badge"
import { Button } from "@/shared/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/shared/ui/card"
import { Field, FieldGroup, FieldLabel, FieldDescription, FieldError } from "@/shared/ui/field"
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
  useEffect(() => {
    void settings.load()
    if (!restricted) void token.read()
  }, [settings, token, restricted])
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
          : "The Token observation changed while copying. Read and copy the current Token again."
      )
    } catch {
      setTokenFeedback("Token could not be copied. Reveal it to copy manually.")
    }
  }
  return (
    <>
      <Card role="region" aria-label="External connection">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>External connection</CardTitle>
            <Badge variant="secondary">
              {settings.dirty
                ? "Unsaved edits"
                : pending
                  ? "Saved · restart required"
                  : settings.runtimeError
                    ? "Status unavailable"
                    : !runtime
                      ? "Checking connection"
                      : runtime.active_address
                        ? "Listening"
                        : "Unavailable"}
            </Badge>
          </div>
          <CardDescription>
            A stable local entry for uploading files and importing supplied content. Address changes take
            effect after a full application restart.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <form
            onSubmit={(event) => {
              event.preventDefault()
              void settings.save()
            }}
          >
            <FieldGroup>
              <Field data-disabled={!settings.editable} data-invalid={addressEmpty || !!settings.problem}>
                <FieldLabel htmlFor="external-address">Saved address</FieldLabel>
                <Input
                  id="external-address"
                  value={settings.draft?.address ?? ""}
                  disabled={!settings.editable}
                  aria-invalid={addressEmpty || !!settings.problem}
                  aria-describedby="external-address-help"
                  onChange={(event) => settings.edit("address", event.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
                <FieldDescription id="external-address-help">
                  Use a loopback IP and a fixed port, for example {settings.defaults.address}.
                </FieldDescription>
                {addressEmpty && <FieldError>Enter a loopback address and port.</FieldError>}
              </Field>
            </FieldGroup>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button type="submit" disabled={!settings.canSave || addressEmpty}>
                <SaveIcon data-icon="inline-start" />
                Save address
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
                Discard address edits
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={settings.busy || settings.readPending}
                onClick={() =>
                  void (settings.attempt || settings.needsEvidence ? settings.recover() : settings.load())
                }
              >
                Reload / recover address
              </Button>
            </div>
          </form>
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
          {settings.conflict && saved && (
            <Alert>
              <AlertTitle>Current saved address</AlertTitle>
              <AlertDescription>{String((saved.value as { address?: unknown }).address)}</AlertDescription>
            </Alert>
          )}
          <div className="flex flex-col gap-2 text-sm">
            <h2 className="font-medium">Active in this run</h2>
            {runtime?.active_address && !settings.runtimeError ? (
              <div className="flex flex-wrap items-center gap-2">
                <code className="break-all">{`http://${runtime.active_address}`}</code>
                <Button
                  variant="ghost"
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
            {settings.status === "saved" && (
              <p role="status">Address saved. Restart the application to apply it.</p>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex flex-wrap justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Default address: {settings.defaults.address}. Restoring it does not change the Token.
          </p>
          <Button
            variant="outline"
            disabled={
              !settings.resetRevision || settings.busy || !!settings.attempt || settings.needsEvidence
            }
            onClick={() => void settings.reset()}
          >
            <RotateCcwIcon data-icon="inline-start" />
            Restore default address
          </Button>
        </CardFooter>
      </Card>
      <Card role="region" aria-label="Shared Token">
        <CardHeader>
          <CardTitle>Shared Token</CardTitle>
          <CardDescription>
            Every holder shares this library’s upload, import and related-result access. Supply it as an
            Authorization: Bearer header.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="external-token">Current Token</FieldLabel>
              <Input
                id="external-token"
                type={reveal && current ? "text" : "password"}
                value={current?.token ?? ""}
                readOnly
                autoComplete="off"
                spellCheck={false}
                placeholder={token.pending ? "Reading or replacing Token…" : "Current Token unavailable"}
              />
              <FieldDescription>
                Reset immediately invalidates the old Token. Accepted work and uploaded files remain available
                through the new Token.
              </FieldDescription>
            </Field>
          </FieldGroup>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!current}
              onClick={() => {
                setRevealedRevision(reveal ? undefined : current?.revision)
                setTokenFeedback(reveal ? "Token hidden." : "Token revealed locally.")
              }}
            >
              {reveal ? <EyeOffIcon data-icon="inline-start" /> : <EyeIcon data-icon="inline-start" />}
              {reveal ? "Hide Token" : "Reveal Token"}
            </Button>
            <Button variant="outline" disabled={!current} onClick={() => void copyToken()}>
              <CopyIcon data-icon="inline-start" />
              Copy Token
            </Button>
            <Button
              variant="ghost"
              disabled={token.pending || !!restricted}
              onClick={() => void token.recover()}
            >
              {token.attempt ? "Recover Token reset" : "Read current Token"}
            </Button>
          </div>
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
          <p role="status" aria-live="polite" className="text-sm text-muted-foreground">
            {token.pending ? "Waiting for the access operation…" : token.feedback}
          </p>
          {tokenFeedback && (
            <p role="status" className="text-sm text-muted-foreground">
              {tokenFeedback}
            </p>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            All clients using the old Token must update it after reset.
          </p>
          <Button
            variant="outline"
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
        </CardFooter>
      </Card>
    </>
  )
}
