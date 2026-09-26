import { useEffect, useId, useRef, useState, type ComponentProps } from "react"
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"
import { ToastIcon } from "@/shared/ui/toast"
import { cn } from "@/shared/lib/utils"
import type { Notification } from "./notification-history"

const statusLabels: Record<string, string> = {
  success: "Success",
  info: "Info",
  warning: "Warning",
  error: "Error",
  loading: "In progress",
}

export function NotificationItem({
  item,
  action,
  remove,
}: {
  item: Notification
  action?: ComponentProps<"button">
  remove: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [overflow, setOverflow] = useState(false)
  const description = useRef<HTMLDivElement>(null)
  const descriptionId = useId()
  useEffect(() => {
    const element = description.current
    if (!element || expanded) return
    const measure = () => setOverflow(element.scrollHeight > element.clientHeight + 1)
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
    return () => observer.disconnect()
  }, [item.description, expanded])
  return (
    <li className="group/notice flex min-w-0 items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted",
          item.type === "error" && "bg-destructive/10",
        )}
      >
        <ToastIcon type={item.type ?? "info"} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start gap-1">
          <div className="min-w-0 flex-1 text-sm font-medium leading-5 [overflow-wrap:anywhere]">
            {item.title}
          </div>
          <Button
            variant="ghost"
            size="icon-xs"
            className="-mt-0.5 -mr-1 [@media(hover:hover)]:opacity-0 group-hover/notice:opacity-100 group-focus-within/notice:opacity-100"
            aria-label="Remove notification"
            title="Remove notification"
            onClick={remove}
          >
            <XIcon />
          </Button>
        </div>
        {item.description && (
          <div
            ref={description}
            id={descriptionId}
            className={cn(
              "text-sm leading-5 text-muted-foreground [overflow-wrap:anywhere]",
              !expanded && "line-clamp-2",
            )}
          >
            {item.description}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span>{statusLabels[item.type ?? "info"] ?? "Notification"}</span>
          <span aria-hidden="true">·</span>
          <time
            dateTime={new Date(item.receivedAt).toISOString()}
            title={new Date(item.receivedAt).toLocaleString()}
            className="tabular-nums"
          >
            {new Date(item.receivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </time>
          {(overflow || expanded) && (
            <Button
              variant="ghost"
              size="xs"
              className="ml-auto"
              aria-expanded={expanded}
              aria-controls={descriptionId}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Show less" : "Show more"}
              {expanded ? (
                <ChevronUpIcon data-icon="inline-end" />
              ) : (
                <ChevronDownIcon data-icon="inline-end" />
              )}
            </Button>
          )}
        </div>
        {action && (
          <div className="mt-1">
            <Button variant="outline" size="sm" {...action} />
          </div>
        )}
      </div>
    </li>
  )
}
