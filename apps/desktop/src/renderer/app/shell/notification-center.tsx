import { useRef, useState } from "react"
import { BellIcon, ListXIcon, XIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { Badge } from "@/shared/ui/badge"
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from "@/shared/ui/empty"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
} from "@/shared/ui/popover"
import { Separator } from "@/shared/ui/separator"
import { useToastManager } from "@/shared/ui/toast"
import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group"
import { ScrollArea } from "@/shared/ui/scroll-area"
import { useNotifications } from "./notification-provider"
import { NotificationItem } from "./notification-item"

export function NotificationCenter() {
  const { records, open, setOpen, remove, clear } = useNotifications()
  const { toasts } = useToastManager()
  const [filter, setFilter] = useState("all")
  const panel = useRef<HTMLDivElement>(null)
  const issues = records.filter((item) => item.type === "warning" || item.type === "error")
  const visible = filter === "issues" ? issues : records
  const unread = records.filter((item) => item.unread).length
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="sm" />}
        aria-label={`Notifications${unread ? ` · ${unread} unread` : ""}`}
      >
        <BellIcon data-icon="inline-start" />
        Notifications
        {unread > 0 && <Badge variant="secondary">{unread}</Badge>}
      </PopoverTrigger>
      <PopoverContent
        ref={panel}
        initialFocus={panel}
        side="top"
        align="end"
        sideOffset={10}
        className="w-96 max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0"
      >
        <div className="flex items-center gap-2 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <PopoverTitle>Notifications</PopoverTitle>
            <PopoverDescription className="sr-only">Notices from this session.</PopoverDescription>
          </div>
          {records.length > 0 && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={clear}
              aria-label="Clear all"
              title="Clear all notifications"
            >
              <ListXIcon />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
          >
            <XIcon />
          </Button>
        </div>
        {records.length > 0 && (
          <div className="px-4 pb-3">
            <ToggleGroup
              aria-label="Filter notifications"
              size="sm"
              value={[filter]}
              onValueChange={(values) => {
                if (values[0]) setFilter(values[0])
              }}
            >
              <ToggleGroupItem value="all" aria-label="All notifications">
                All <span className="tabular-nums text-muted-foreground">{records.length}</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="issues" aria-label="Warnings and errors">
                Warnings & errors <span className="tabular-nums text-muted-foreground">{issues.length}</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        )}
        <Separator />
        <ScrollArea viewportProps={{ className: "max-h-[min(26rem,calc(100dvh-10rem))] overscroll-contain" }}>
          {visible.length === 0 ? (
            <Empty className="flex-row justify-start gap-3 p-4 text-left">
              <EmptyMedia className="mb-0">
                <BellIcon />
              </EmptyMedia>
              <EmptyHeader className="items-start gap-1">
                <EmptyTitle>{records.length ? "No warnings or errors" : "No notifications yet"}</EmptyTitle>
                <EmptyDescription>
                  {records.length
                    ? "Other notices are available in All."
                    : "Recent notices will appear here."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex min-w-0 flex-col divide-y">
              {visible.map((item) => {
                // Actions belong to the live source; archived notices never keep stale callbacks.
                const live = toasts.find(
                  (value) => value.id === item.id && value.transitionStatus !== "ending",
                )
                return (
                  <NotificationItem
                    key={item.id}
                    item={item}
                    action={live?.actionProps}
                    remove={() => remove(item.id)}
                  />
                )
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  )
}
