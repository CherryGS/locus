import { taskRecords } from "./task-records"
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react"
import { ListChecksIcon } from "lucide-react"
import { ImportDetails } from "@/features/file-import"
import { TaskPanel } from "@/features/task-feedback"
import { Button } from "@/shared/ui/button"
import { Dialog, DialogTrigger } from "@/shared/ui/dialog"
import type { DialogRootActions } from "@base-ui/react/dialog"
import { useLibrarySession } from "../providers/library-provider"
import type { LibrarySession } from "../providers/library-session"
import { useImportView } from "./use-import-view"

export function TaskWorkspace({ children }: { children: ReactNode }) {
  const session = useLibrarySession()
  return session ? (
    <ConnectedWorkspace session={session}>{children}</ConnectedWorkspace>
  ) : (
    <div className="flex min-h-0 flex-1">{children}</div>
  )
}
function ConnectedWorkspace({ session, children }: { session: LibrarySession; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const entry = useRef<HTMLButtonElement>(null)
  const dialogActions = useRef<DialogRootActions | null>(null)
  const closing = useRef(false)
  const [hostClosing, setHostClosing] = useState(false)
  useEffect(
    () =>
      session.bridge.observe((state) => {
        closing.current = state.close.phase !== "idle"
        setHostClosing(closing.current)
        // The host's preparation dialog has priority; retain Tasks' mounted state
        // without keeping a competing sibling modal or stealing its focus.
        if (closing.current) {
          setOpen(false)
        }
      }),
    [session],
  )
  useLayoutEffect(() => {
    // Finish closing after the primitive has received open=false, before a key
    // can reach its outgoing animation's guards instead of host preparation.
    // Portal keepMounted still retains task details and pending View errors.
    if (!open && hostClosing) dialogActions.current?.unmount()
  }, [open, hostClosing])
  const view = useImportView(session, () => !closing.current)
  const c = session.imports,
    observer = session.tasks
  const problem =
    [...new Set([observer.problem, c.problem, ...c.notices].filter(Boolean))].join("\n") || undefined
  useSyncExternalStore(c.subscribe, c.snapshot)
  useSyncExternalStore(observer.subscribe, observer.snapshot)
  const all = taskRecords(c, observer, (id, pendingRequestId) => (
    <ImportDetails
      coordinator={c}
      batchId={id}
      pendingRequestId={pendingRequestId}
      view={async (id) => {
        const error = await view(id)
        if (!error) setOpen(false)
        return error
      }}
      tasks={[...observer.records.values()].map((r) => r.task)}
    />
  ))
  const active = all.filter((record) => record.active).length
  const attention = all.filter((record) => record.attention).length
  return (
    <Dialog open={open} onOpenChange={setOpen} actionsRef={dialogActions}>
      <div className="flex min-h-0 flex-1">{children}</div>
      <TaskPanel
        records={all}
        problem={problem}
        established={observer.established}
        finalFocus={() => (closing.current ? false : entry.current)}
        reread={() => {
          void observer.reread()
          void c.observe()
        }}
        retryOutcome={(id) => void observer.outcome(id)}
      />
      <footer aria-label="Application footer" className="flex shrink-0 items-center border-t bg-sidebar px-2">
        <DialogTrigger ref={entry} render={<Button variant="ghost" size="sm" />}>
          <ListChecksIcon data-icon="inline-start" />
          Tasks · {all.length} records{active ? ` · ${active} active` : ""}
          {attention ? ` · ${attention} need attention` : ""}
          {problem ? " · feedback needs attention" : ""}
        </DialogTrigger>
      </footer>
    </Dialog>
  )
}
