import { useState } from "react"
import { CircleHelpIcon, FolderOpenIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/shared/ui/popover"
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
      if (!switchLibrary) throw new Error("Library switching is available in the desktop application.")
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
        library?.source && (
          <Badge variant="outline" title={library.source.name}>
            {library.source.kind === "environment"
              ? `ENV · ${library.source.name}`
              : {
                  startup: "Startup argument",
                  selection: "Chosen library",
                  "path-file": "Locus/path",
                  default: "Default location",
                  preview: "Preview configuration",
                }[library.source.kind]}
          </Badge>
        )
      }
    >
      <div className="flex flex-col gap-3 px-4 pb-4">
        <p className="break-all font-mono text-sm">
          {library?.root ?? "Library location is available in the desktop application."}
        </p>
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
        <div className="flex flex-wrap items-center gap-1">
          <Button variant="outline" size="sm" disabled={pending} onClick={() => void choose()}>
            <FolderOpenIcon data-icon="inline-start" />
            {pending ? "Choosing library…" : "Choose library and restart"}
          </Button>
          <Popover>
            <PopoverTrigger
              render={<Button variant="ghost" size="icon-sm" />}
              aria-label="About library switching"
            >
              <CircleHelpIcon aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent align="start">
              <PopoverTitle>Library switching</PopoverTitle>
              <PopoverDescription>
                Locus finishes current work before restarting. Files stay in their original libraries.
                Your selection is remembered for future launches. Explicit startup paths take priority.
              </PopoverDescription>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </SettingsGroup>
  )
}
