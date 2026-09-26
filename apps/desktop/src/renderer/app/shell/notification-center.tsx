import { BellIcon, XIcon } from "lucide-react"
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
import { ToastIcon, useToastManager } from "@/shared/ui/toast"
import { useNotifications } from "./notification-provider"

export function NotificationCenter() {
  const { records, open, setOpen, remove, clear } = useNotifications()
  const { toasts } = useToastManager()
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
        side="top"
        align="end"
        sideOffset={10}
        className="w-96 max-w-[calc(100vw-1rem)] gap-0 overflow-hidden p-0"
      >
        <div className="flex items-start gap-3 p-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <PopoverTitle>Notifications</PopoverTitle>
            <PopoverDescription>
              This session{records.length ? ` · ${records.length}` : ""}
            </PopoverDescription>
          </div>
          {records.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clear}>
              Clear all
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
        <Separator />
        <div className="max-h-[min(28rem,60dvh)] overflow-y-auto overscroll-contain">
          {records.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BellIcon />
                </EmptyMedia>
                <EmptyTitle>No notifications yet</EmptyTitle>
                <EmptyDescription>Recent notices stay here after their toast disappears.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="flex min-w-0 flex-col divide-y">
              {records.map((item) => {
                // Actions belong to the live source; archived notices never keep stale callbacks.
                const live = toasts.find(
                  (value) => value.id === item.id && value.transitionStatus !== "ending",
                )
                return (
                  <li key={item.id} className="flex min-w-0 items-start gap-3 p-4">
                    <span className="mt-0.5">
                      <ToastIcon type={item.type ?? "info"} />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="text-sm font-medium [overflow-wrap:anywhere]">{item.title}</div>
                      {item.description && (
                        <div className="text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                          {item.description}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <time
                          dateTime={new Date(item.receivedAt).toISOString()}
                          className="text-xs text-muted-foreground"
                        >
                          {new Date(item.receivedAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                        {live?.actionProps && <Button variant="outline" size="sm" {...live.actionProps} />}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Remove notification"
                      onClick={() => remove(item.id)}
                    >
                      <XIcon />
                    </Button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
