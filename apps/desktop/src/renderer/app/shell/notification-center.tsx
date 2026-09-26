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
        className="w-96 max-w-[calc(100vw-2rem)] gap-0 overflow-hidden p-0"
      >
        <div className="flex items-center gap-2 px-4 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <PopoverTitle>Notifications</PopoverTitle>
            {records.length > 0 && <Badge variant="secondary">{records.length}</Badge>}
            <PopoverDescription className="sr-only">Notices from this session.</PopoverDescription>
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
            <Empty className="flex-row justify-start gap-3 p-4 text-left">
              <EmptyMedia className="mb-0">
                <BellIcon />
              </EmptyMedia>
              <EmptyHeader className="items-start gap-1">
                <EmptyTitle>No notifications yet</EmptyTitle>
                <EmptyDescription>Recent notices will appear here.</EmptyDescription>
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
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <div className="flex items-baseline gap-2">
                        <div className="min-w-0 flex-1 text-sm font-medium [overflow-wrap:anywhere]">
                          {item.title}
                        </div>
                        <time
                          dateTime={new Date(item.receivedAt).toISOString()}
                          className="shrink-0 text-xs text-muted-foreground"
                        >
                          {new Date(item.receivedAt).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                      {item.description && (
                        <div className="text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
                          {item.description}
                        </div>
                      )}
                      {live?.actionProps && (
                        <div className="mt-1">
                          <Button variant="outline" size="sm" {...live.actionProps} />
                        </div>
                      )}
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
