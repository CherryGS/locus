import { useState } from "react"
import { ChevronRightIcon, MoreHorizontalIcon } from "lucide-react"
import type { Wire } from "@/shared/api"
import { Button } from "@/shared/ui/button"
import { Popover, PopoverTrigger, PopoverContent, PopoverTitle } from "@/shared/ui/popover"
import { ScrollArea } from "@/shared/ui/scroll-area"

export function TagBreadcrumbs({
  path,
  selected,
  onSelect,
}: {
  path: Wire<"TagRecord">[]
  selected?: string
  onSelect: (id: string) => void
}) {
  const current = path.findIndex((tag) => tag.id === selected),
    visible =
      path.length <= 3
        ? path.map((_, index) => index)
        : [...new Set([0, current >= 0 ? current : path.length - 1, path.length - 1])].sort(
            (a, b) => a - b,
          )
  return (
    <nav aria-label="Tag path" className="min-w-0 flex-1 overflow-hidden">
      <ol className="flex min-w-0 items-center gap-1">
        {visible.map((index, position) => {
          const tag = path[index],
            previous = visible[position - 1],
            skipped = position ? path.slice(previous + 1, index) : []
          return (
            <li key={tag.id} className="flex min-w-0 shrink items-center gap-1">
              {!!position && (
                <ChevronRightIcon
                  aria-hidden="true"
                  className="size-3 shrink-0 text-muted-foreground"
                />
              )}
              {!!skipped.length && (
                <>
                  <HiddenPath tags={skipped} onSelect={onSelect} />
                  <ChevronRightIcon
                    aria-hidden="true"
                    className="size-3 shrink-0 text-muted-foreground"
                  />
                </>
              )}
              <Button
                variant={tag.id === selected ? "secondary" : "ghost"}
                size="xs"
                className="min-w-0 max-w-full shrink"
                title={tag.name}
                aria-label={`Locate ${tag.name}`}
                aria-current={tag.id === selected ? "location" : undefined}
                onClick={() => onSelect(tag.id)}
              >
                <span className="truncate">{tag.name}</span>
              </Button>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

function HiddenPath({
  tags,
  onSelect,
}: {
  tags: Wire<"TagRecord">[]
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="icon-xs" />}
        aria-label="Show hidden path tags"
        title="Hidden path tags"
      >
        <MoreHorizontalIcon />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64">
        <PopoverTitle className="sr-only">Hidden path tags</PopoverTitle>
        <ScrollArea className="max-h-72" viewportProps={{ className: "max-h-72" }}>
          <div className="flex flex-col gap-1">
            {tags.map((tag) => (
              <Button
                key={tag.id}
                variant="ghost"
                size="sm"
                className="min-w-0 justify-start"
                title={tag.name}
                aria-label={`Locate ${tag.name}`}
                onClick={() => {
                  setOpen(false)
                  onSelect(tag.id)
                }}
              >
                <span className="truncate">{tag.name}</span>
              </Button>
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
