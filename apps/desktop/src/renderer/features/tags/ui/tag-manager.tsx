import { useId, useState, useSyncExternalStore } from "react"
import type { Wire } from "@/shared/api"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/shared/ui/dialog"
import { Field, FieldLabel, FieldDescription, FieldGroup } from "@/shared/ui/field"
import { Input } from "@/shared/ui/input"
import { Button } from "@/shared/ui/button"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription } from "@/shared/ui/empty"
import { Spinner } from "@/shared/ui/spinner"
import type { TagCoordinator } from "../model/tag-coordinator"
import { TagFeedback } from "./tag-feedback"
export function TagManager({ coordinator: c }: { coordinator: TagCoordinator }) {
  useSyncExternalStore(c.subscribe, c.snapshot)
  const prefix = useId()
  const [name, setName] = useState(""),
    [find, setFind] = useState("")
  const [editing, setEditing] = useState<{ tag: Wire<"TagRecord">; name: string }>(),
    [deleting, setDeleting] = useState<Wire<"TagRecord">>()
  const [formError, setFormError] = useState<string>()
  const submit = async () => {
    setFormError(undefined)
    const result = await c.write({ operation: "create", name }, `Create ${name}`)
    if (result?.state === "confirmed") setName("")
    else if (result?.state === "failed") setFormError(result.message)
  }
  const globalAttempts = c.attempts.filter((a) => !("entity_id" in a.change))
  return (
    <Dialog open={c.opened} onOpenChange={(open) => (open ? c.show() : c.close())}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Personal tags</DialogTitle>
          <DialogDescription>
            Library vocabulary. Creating a tag does not assign it to content. Names are trimmed and
            case-sensitive.
          </DialogDescription>
        </DialogHeader>
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <FieldGroup>
              <Field data-invalid={!!formError}>
                <FieldLabel htmlFor={`${prefix}-name`}>New tag name</FieldLabel>
                <Input
                  id={`${prefix}-name`}
                  value={name}
                  aria-invalid={!!formError}
                  onChange={(e) => {
                    setName(e.target.value)
                    setFormError(undefined)
                  }}
                  disabled={c.hostClosing || c.pending}
                />
                <FieldDescription>
                  Names must be nonblank and unique. cat and Cat are different.
                </FieldDescription>
              </Field>
              <Button type="submit" disabled={c.hostClosing || c.pending}>
                {c.pending && <Spinner />}Create tag
              </Button>
            </FieldGroup>
          </form>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${prefix}-find`}>Find tags</FieldLabel>
              <Input id={`${prefix}-find`} value={find} onChange={(e) => setFind(e.target.value)} />
            </Field>
          </FieldGroup>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={c.loading} onClick={() => void c.read()}>
              Refresh vocabulary
            </Button>
            {c.loading && <Spinner />}
          </div>
          {c.readError && (
            <Alert>
              <AlertDescription>
                Vocabulary read failed: {c.readError}.{" "}
                {c.vocabulary ? "Showing previous vocabulary." : ""}
              </AlertDescription>
            </Alert>
          )}
          {c.vocabulary?.length === 0 && !c.readError && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No tags yet</EmptyTitle>
                <EmptyDescription>Create your first personal tag above.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          <div className="flex flex-col gap-2">
            {c.vocabulary
              ?.filter((t) => t.name.toLocaleLowerCase().includes(find.toLocaleLowerCase()))
              .map((t) => (
                <div
                  key={t.id}
                  className="flex flex-wrap items-center gap-2 rounded-md border p-3"
                  data-tag-id={t.id}
                >
                  <span className="min-w-0 flex-1 break-all font-medium">{t.name}</span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={c.hostClosing || c.pending || !!c.readError}
                    onClick={() => setEditing({ tag: t, name: t.name })}
                    aria-label={`Rename ${t.name}`}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={c.hostClosing || c.pending || !!c.readError}
                    onClick={() => setDeleting(t)}
                    aria-label={`Delete ${t.name} globally`}
                  >
                    Delete
                  </Button>
                </div>
              ))}
          </div>
          <TagFeedback
            coordinator={c}
            attempts={c.attempts.filter(
              (a) => !("entity_id" in a.change) || a.state === "pending" || a.state === "unconfirmed",
            )}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => c.close()}>
            Done
          </Button>
        </DialogFooter>
        <Dialog
          open={!!editing}
          onOpenChange={(open) => {
            if (!open) setEditing(undefined)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rename tag everywhere</DialogTitle>
              <DialogDescription>
                The shared name changes on every annotated Entity. The Tag identity stays the same.
              </DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor={`${prefix}-rename`}>Tag name</FieldLabel>
                <Input
                  id={`${prefix}-rename`}
                  disabled={c.pending || c.hostClosing}
                  value={editing?.name ?? ""}
                  onChange={(e) => setEditing((v) => (v ? { ...v, name: e.target.value } : v))}
                />
              </Field>
            </FieldGroup>
            <TagFeedback coordinator={c} attempts={globalAttempts.slice(-1)} />
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => {
                  void c.read().then(() =>
                    setEditing((v) => {
                      const latest = c.vocabulary?.find((t) => t.id === v?.tag.id)
                      return v && latest ? { ...v, tag: latest } : v
                    }),
                  )
                }}
              >
                Use latest observation
              </Button>
              <Button variant="outline" onClick={() => setEditing(undefined)}>
                Cancel
              </Button>
              <Button
                disabled={c.hostClosing || c.pending}
                onClick={() => {
                  if (editing) {
                    const captured = editing
                    void c
                      .write(
                        {
                          operation: "rename",
                          id: captured.tag.id,
                          revision: captured.tag.revision,
                          name: captured.name,
                        },
                        `Rename ${captured.tag.name}`,
                      )
                      .then((a) => {
                        if (a?.state === "confirmed") setEditing(undefined)
                      })
                  }
                }}
              >
                Save name
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
        <Dialog
          open={!!deleting}
          onOpenChange={(open) => {
            if (!open) setDeleting(undefined)
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete tag globally?</DialogTitle>
              <DialogDescription>
                Delete “{deleting?.name}” from the vocabulary and remove its assignments from all
                content. Content and other tags remain.
              </DialogDescription>
            </DialogHeader>
            <TagFeedback coordinator={c} attempts={globalAttempts.slice(-1)} />
            <DialogFooter>
              <Button variant="outline" onClick={() => setDeleting(undefined)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={c.hostClosing || c.pending}
                onClick={() => {
                  if (deleting) {
                    const captured = deleting
                    void c
                      .write(
                        { operation: "delete", id: captured.id, revision: captured.revision },
                        `Delete ${captured.name} globally`,
                      )
                      .then((a) => {
                        if (a?.state === "confirmed") setDeleting(undefined)
                      })
                  }
                }}
              >
                Delete tag globally
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}
