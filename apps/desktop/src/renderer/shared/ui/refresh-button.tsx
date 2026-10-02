import type { ComponentProps } from "react"
import { RefreshCwIcon } from "lucide-react"
import { Button } from "./button"
import { cn } from "@/shared/lib/utils"
import { useDelayedPending } from "@/shared/lib/use-delayed-pending"

export function RefreshButton({ pending, disabled, ...props }:
  Omit<ComponentProps<typeof Button>, "children"> & { pending: boolean }) {
  const spinning = useDelayedPending(pending)
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      {...props}
      disabled={pending || disabled}
      focusableWhenDisabled={pending && !disabled}
      aria-busy={pending}
    >
      <RefreshCwIcon
        data-icon="inline-start"
        className={cn(spinning && "animate-spin motion-reduce:animate-none")}
      />
    </Button>
  )
}
