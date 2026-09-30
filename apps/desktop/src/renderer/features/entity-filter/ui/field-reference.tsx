import { useState } from "react"
import { ChevronRightIcon, SearchIcon, XIcon } from "lucide-react"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Button } from "@/shared/ui/button"
import { CopyIdentityButton } from "@/shared/ui/copy-identity-button"
import { Empty, EmptyHeader, EmptyTitle } from "@/shared/ui/empty"
import { Field, FieldLabel } from "@/shared/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/shared/ui/input-group"
import { ScrollArea } from "@/shared/ui/scroll-area"
import type { FilterCoordinator } from "../model/filter-coordinator"

export function FieldReference({
  coordinator: c,
  close,
}: {
  coordinator: FilterCoordinator
  close: () => void
}) {
  const [find, setFind] = useState("")
  const groups = new Map<string, NonNullable<typeof c.catalogue>["fields"]>()
  const query = find.trim().toLocaleLowerCase()
  for (const field of c.catalogue?.fields ?? []) {
    if (`${field.owner} ${field.id}`.toLocaleLowerCase().includes(query))
      groups.set(field.owner, [...(groups.get(field.owner) ?? []), field])
  }
  return (
    <aside
      id="filter-field-reference"
      aria-label="Field reference"
      className="flex min-h-0 min-w-0 flex-col gap-3 sm:border-l sm:pl-4"
    >
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Fields</h3>
        <Button variant="ghost" size="icon-sm" aria-label="Close fields" onClick={close}>
          <XIcon />
        </Button>
      </div>
      <Field className="shrink-0">
        <FieldLabel htmlFor="filter-find" className="sr-only">Find fields</FieldLabel>
        <InputGroup>
          <InputGroupAddon><SearchIcon /></InputGroupAddon>
          <InputGroupInput
            id="filter-find"
            placeholder="Search fields…"
            value={find}
            onChange={(event) => setFind(event.target.value)}
          />
        </InputGroup>
      </Field>
      <ScrollArea
        className="min-h-0 flex-1"
        viewportProps={{ "aria-label": "Field list", className: "overscroll-contain" }}
        scrollbarProps={{ className: "data-vertical:w-1.5" }}
      >
        <div className="flex flex-col gap-5 pr-3 pb-1">
          {c.cataloguePending && <p role="status" className="text-xs text-muted-foreground">Loading fields…</p>}
          {c.catalogueError && (
            <Alert variant="destructive">
              <AlertDescription>
                {c.catalogueError}
                <Button size="sm" variant="outline" onClick={() => void c.readCatalogue()}>Retry catalogue</Button>
              </AlertDescription>
            </Alert>
          )}
          {[...groups].map(([owner, fields]) => (
            <section key={owner} className="flex flex-col gap-1">
              <h4 className="mb-1 text-xs font-medium text-muted-foreground">{owner}</h4>
              {fields.map((field) => (
                <details key={field.id} className="group/field-reference" data-field-id={field.id}>
                  <summary className="flex cursor-pointer list-none items-start gap-2 rounded-md px-2 py-2 hover:bg-accent focus-visible:outline-1 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                    <ChevronRightIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground transition-transform group-open/field-reference:rotate-90" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <code className="break-all text-xs">{field.id}</code>
                      <span className="text-xs text-muted-foreground">
                        {field.field_type}{field.unit ? ` · ${field.unit}` : ""}
                      </span>
                    </span>
                  </summary>
                  <div className="ml-5 mb-2 flex min-w-0 flex-col gap-2 border-l py-1 pr-2 pl-3">
                    <p className="text-xs text-muted-foreground">{field.shape}</p>
                    <div>
                      <p className="text-xs text-muted-foreground">{field.field_type === "text" ? "Text match" : "Query field"}</p>
                      <CopyIdentityButton label={`${field.id} query field`} value={field.native_value} />
                    </div>
                    {field.native_exact !== field.native_value && (
                      <div>
                        <p className="text-xs text-muted-foreground">Exact match</p>
                        <CopyIdentityButton label={`${field.id} exact field`} value={field.native_exact} />
                      </div>
                    )}
                    <div>
                      <p className="text-xs text-muted-foreground">Has a value</p>
                      <CopyIdentityButton label={`${field.id} presence example`} value={`${field.native_value}:*`} />
                    </div>
                    {field.owner === "tag" && field.field_type === "text" && (
                      <div>
                        <p className="text-xs text-muted-foreground">Exact tag example</p>
                        <CopyIdentityButton label="exact tag example" value={`${field.native_exact}:"cat"`} />
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </section>
          ))}
          {c.catalogue && !c.cataloguePending && !c.catalogueError && groups.size === 0 && (
            <Empty>
              <EmptyHeader><EmptyTitle>No matching fields</EmptyTitle></EmptyHeader>
            </Empty>
          )}
        </div>
      </ScrollArea>
    </aside>
  )
}
