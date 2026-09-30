import { useState } from "react"
import { SearchIcon } from "lucide-react"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Button } from "@/shared/ui/button"
import { CopyIdentityButton } from "@/shared/ui/copy-identity-button"
import { Empty, EmptyHeader, EmptyTitle } from "@/shared/ui/empty"
import { Field, FieldLabel } from "@/shared/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/shared/ui/input-group"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/shared/ui/popover"
import type { FilterCoordinator } from "../model/filter-coordinator"

export function FieldReference({ coordinator: c }: { coordinator: FilterCoordinator }) {
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
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 border-t pt-3"
    >
      <h3 className="sr-only">Fields</h3>
      <div className="flex shrink-0 items-center gap-3">
        <Field className="min-w-0 flex-1">
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
        <Popover>
          <PopoverTrigger render={<Button variant="ghost" size="sm" />}>Syntax</PopoverTrigger>
          <PopoverContent align="end">
            <PopoverTitle>Query syntax</PopoverTitle>
            {c.language?.syntax.map((syntax) => (
              <p key={syntax} className="text-xs text-muted-foreground">{syntax}</p>
            ))}
            {c.helpError && (
              <Alert variant="destructive">
                <AlertDescription>
                  {c.helpError}
                  <Button size="sm" variant="outline" onClick={() => void c.readHelp()}>Retry help</Button>
                </AlertDescription>
              </Alert>
            )}
          </PopoverContent>
        </Popover>
      </div>
      <ScrollArea
        className="min-h-0 flex-1"
        viewportProps={{ "aria-label": "Field list", className: "overscroll-contain" }}
        scrollbarProps={{ className: "data-vertical:w-1.5" }}
      >
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 pr-3 pb-1 sm:grid-cols-2">
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
            <section key={owner} className="flex flex-col">
              <h4 className="mb-1 text-xs font-medium text-muted-foreground">{owner}</h4>
              {fields.map((field) => (
                <div key={field.id} data-field-id={field.id}>
                  <div className="flex min-w-0 items-start gap-2">
                    <CopyIdentityButton label={`${field.id} query field`} value={field.native_value} />
                    <span className="shrink-0 pt-1 text-xs text-muted-foreground" title={`${field.field_type} · ${field.shape}${field.unit ? ` · ${field.unit}` : ""}`}>
                      {field.unit ?? field.field_type}
                    </span>
                  </div>
                  {field.native_exact !== field.native_value && (
                    <div className="flex min-w-0 items-start gap-2">
                      <CopyIdentityButton label={`${field.id} exact field`} value={field.native_exact} />
                      <span className="shrink-0 pt-1 text-xs text-muted-foreground">exact</span>
                    </div>
                  )}
                </div>
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
