import { useEffect, useSyncExternalStore } from "react"
import { RouterProvider } from "@tanstack/react-router"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator } from "@/shared/ui/dropdown-menu"
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs"
import { ChevronDownIcon, XIcon, PlusIcon, CircleAlertIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Empty, EmptyHeader, EmptyTitle } from "@/shared/ui/empty"
import { Separator } from "@/shared/ui/separator"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/shared/ui/dialog"
import { PageActivityContext } from "@/shared/page-activity"
import { SettingsDialog } from "./settings-dialog"
import { useSettingsWorkspace } from "./settings-navigation"
import { TaskWorkspace } from "./task-workspace"
import { PageSessionContext, useLibraryRun } from "../providers/library-provider"
import type { PageCategory } from "../providers/workspace-session"

export function DesktopShell() {
  const run = useLibraryRun()
  const { external, media } = useSettingsWorkspace()
  const settingsStatus = [external, media].filter(Boolean).join("; ")
  const workspace = run?.workspace
  useSyncExternalStore(workspace?.subscribe ?? noSubscribe, workspace?.snapshot ?? zero)
  useSyncExternalStore(run?.imports.subscribe ?? noSubscribe, run?.imports.snapshot ?? zero)
  useEffect(() => {
    if (!workspace || workspace.initialEntryHandled) return
    workspace.initialEntryHandled = true
    if (!location.hash || location.hash === "#/") return
    const entry = location.hash.slice(1)
    const page = workspace.open(entry.startsWith("/tag") ? "Tags" : "All content")
    page.router.history.replace(entry)
  }, [workspace])
  return <div className="flex h-dvh min-w-0 flex-col overflow-hidden bg-background text-foreground">
    <header className="title-bar shrink-0 bg-sidebar">
      <div className="title-bar-content flex items-center gap-2 px-2">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />} aria-label="Locus" aria-description={settingsStatus ? `Settings: ${settingsStatus}` : undefined} title={settingsStatus ? `Settings: ${settingsStatus}` : "Locus"} id="locus-launcher">
            Locus {settingsStatus && <CircleAlertIcon />}<ChevronDownIcon data-icon="inline-end" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
              <DropdownMenuGroup>
                {(["Media", "Models", "All content", "Tags"] as PageCategory[]).map(category =>
                  <DropdownMenuItem key={category} onClick={() => workspace?.open(category)}>{category}</DropdownMenuItem>)}
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem disabled={!run?.imports.available || run.imports.selecting} onClick={() => void run?.imports.select()}>Import</DropdownMenuItem>
                <DropdownMenuItem id="settings-trigger" aria-label="Settings" aria-description={settingsStatus || undefined} title={settingsStatus || undefined} className="flex-col items-start gap-1" onClick={() => run?.settingsNavigation.setOpen(true)}>Settings{settingsStatus && <span className="max-w-64 text-xs text-muted-foreground">{settingsStatus}</span>}</DropdownMenuItem>
              </DropdownMenuGroup>
</DropdownMenuContent>
        </DropdownMenu>
        <Tabs value={workspace?.activeId ?? null} onValueChange={id => { if (typeof id === "string") workspace?.activate(id) }} className="min-w-0 flex-1">
          <TabsList aria-label="Workspace tabs" className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {workspace?.pages.map(page => <div key={page.id} className="flex shrink-0 items-center rounded-md bg-background/40">
              <TabsTrigger id={`workspace-tab-${page.id}`} aria-controls={`workspace-panel-${page.id}`} value={page.id} render={<Button variant={page.active ? "secondary" : "ghost"} size="sm" />} className="max-w-56 min-w-20 justify-start truncate" title={page.label}>{page.label}</TabsTrigger>
              {page.attention && <Button variant="ghost" size="icon-sm" aria-label={`Resolve ${page.label} edits`} title="Edits need attention" onClick={() => workspace.resolveAttention(page)}><CircleAlertIcon /></Button>}
              <Button variant="ghost" size="icon-sm" aria-label={`Close ${page.label}`} title={`Close ${page.label}`} onClick={() => void workspace.requestClose(page)}><XIcon /></Button>
            </div>)}
          </TabsList>
        </Tabs>
        <Button variant="ghost" size="icon-sm" aria-label="Open page" title="Open All content" onClick={() => workspace?.open("All content")}><PlusIcon /></Button>
      </div>
    </header>
    <Separator />
    <TaskWorkspace>
      <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
        {!workspace?.pages.length && <Empty className="h-full"><EmptyHeader><EmptyTitle>Open a workspace</EmptyTitle></EmptyHeader><Button variant="outline" onClick={() => workspace?.open("Media")}>Open Media</Button></Empty>}
        {/* Keep retained viewports measurable while hidden. Activity gates own
            loading/input/playback; zero-sized layouts would flash on reentry. */}
        {workspace?.pages.map(page => <div key={page.id} id={`workspace-panel-${page.id}`} role="tabpanel" aria-labelledby={`workspace-tab-${page.id}`} tabIndex={-1} data-workspace-page data-page-id={page.id} data-active={String(page.active)}
          aria-hidden={!page.active} inert={!page.active}
          className={`absolute inset-0 h-full min-h-0 min-w-0${page.active ? "" : " invisible"}`}>
          <PageSessionContext value={page}><PageActivityContext value={{ active: page.active, requestClose: () => void workspace.requestClose(page) }}>
            <RouterProvider router={page.router} />
          </PageActivityContext></PageSessionContext>
        </div>)}
      </main>
    </TaskWorkspace>
    <SettingsDialog />
    <Dialog open={!!workspace?.close} onOpenChange={open => { if (!open) workspace?.cancelClose() }}>
      <DialogContent showCloseButton={false} finalFocus={() => document.getElementById(workspace?.activeId ? `workspace-tab-${workspace.activeId}` : "locus-launcher")} onKeyDown={event => event.stopPropagation()}>
        <DialogHeader><DialogTitle>Close {workspace?.close?.page.label}</DialogTitle>
          <DialogDescription>{workspace?.close?.pending ? "Preparing page edits…" : workspace?.close?.state?.blocked ?? "Save your changes before closing this page?"}</DialogDescription></DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => workspace?.cancelClose()}>Cancel</Button>
          {workspace?.close?.state?.blocked ? <Button onClick={() => { const page = workspace.close!.page; workspace.cancelClose(); workspace.resolveAttention(page) }}>Return to page</Button> : <>
            <Button variant="outline" disabled={workspace?.close?.pending} onClick={() => workspace?.finishClose(true)}>Discard and close</Button>
            <Button disabled={workspace?.close?.pending} onClick={() => void workspace?.saveClose()}>Save and close</Button>
          </>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
}
const noSubscribe = () => () => {}
const zero = () => 0
