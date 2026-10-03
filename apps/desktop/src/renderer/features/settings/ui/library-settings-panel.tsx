import { useState } from "react"
import { FolderOpenIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { SettingsGroup } from "./settings-rows"
import type { DesktopBridge, DesktopState } from "../../../../shared/desktop-bridge"

export type LibrarySettingsProps = {
  library?: DesktopState["library"]
  switchLibrary?: DesktopBridge["switchLibrary"]
}

export function LibrarySettingsPanel({ library, switchLibrary }: LibrarySettingsProps) {
  const [pending, setPending] = useState(false)
  const [problem, setProblem] = useState<string>()
  const [message, setMessage] = useState<string>()
  async function choose() {
    setPending(true)
    setProblem(undefined)
    setMessage(undefined)
    try {
      if (!switchLibrary)
        throw new Error("Library switching is available in the desktop application.")
      const result = await switchLibrary()
      if (result.status === "failed") setProblem(result.message)
      if (result.status === "unchanged") setMessage("This library is already open.")
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Unable to select a library.")
    } finally {
      setPending(false)
    }
  }
  return (
    <SettingsGroup
      name="Current library"
      action={
        <Button variant="outline" size="sm" disabled={pending} onClick={() => void choose()}>
          <FolderOpenIcon data-icon="inline-start" />
          {pending ? "Choosing library…" : "Choose library and restart"}
        </Button>
      }
      help={{
        label: "About library switching",
        content: (
          <p>
            Locus finishes current work before restarting. Files stay in their original libraries.
            Your selection is remembered for future launches. Explicit startup paths take priority.
          </p>
        ),
      }}
    >
      <div className="flex min-w-0 flex-col gap-2 px-4 py-3 text-sm select-text">
        <dl className="flex min-w-0 flex-col gap-1">
          <dt className="sr-only">Location</dt>
          <dd className="break-all font-mono text-xs leading-6">
            {library?.root ?? "Library location is available in the desktop application."}
          </dd>
          {library?.source && (
            <>
              <dt className="sr-only">Location source</dt>
              <dd className="text-xs text-muted-foreground" title={library.source.name}>
                {library.source.kind === "environment"
                  ? `ENV · ${library.source.name}`
                  : {
                      startup: "Startup argument",
                      selection: "Chosen library",
                      "path-file": "Locus/path",
                      default: "Default location",
                      preview: "Preview configuration",
                    }[library.source.kind]}
              </dd>
            </>
          )}
        </dl>
        {(problem || library?.notice) && (
          <Alert variant="destructive">
            <AlertDescription>{problem ?? library?.notice}</AlertDescription>
          </Alert>
        )}
        {message && (
          <p role="status" className="text-xs text-muted-foreground">
            {message}
          </p>
        )}
      </div>
    </SettingsGroup>
  )
}
