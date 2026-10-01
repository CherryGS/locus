import { useState } from "react"
import { SearchIcon } from "lucide-react"
import { Alert, AlertDescription } from "@/shared/ui/alert"
import { Button } from "@/shared/ui/button"
import { Empty, EmptyHeader, EmptyTitle } from "@/shared/ui/empty"
import { Field, FieldLabel } from "@/shared/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/shared/ui/input-group"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/shared/ui/popover"
import type { FilterCoordinator } from "../model/filter-coordinator"
import { FieldReferenceRow } from "./field-reference-row"

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
      className="@container flex min-h-0 min-w-0 flex-1 flex-col gap-3 border-t pt-3"
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
      {/* Keep focus scrolling inside this viewport, rather than the resizable dialog. */}
      <ScrollArea
        className="min-h-0 flex-1 overflow-clip"
        viewportProps={{ "aria-label": "Field list", className: "overscroll-contain" }}
        scrollbarProps={{ className: "data-vertical:w-1.5" }}
      >
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 pr-3 pb-1 @xl:grid-cols-2">
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
                  <FieldReferenceRow
                    label={`${field.id} query field`}
                    value={field.native_value}
                    type={field.unit ?? field.field_type}
                    description={`${field.field_type} · ${field.shape}${field.unit ? ` · ${field.unit}` : ""}`}
                  />
                  {field.native_exact !== field.native_value && (
                    <FieldReferenceRow
                      label={`${field.id} exact field`}
                      value={field.native_exact}
                      type="exact"
                      description={`${field.field_type} · ${field.shape}`}
                    />
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
