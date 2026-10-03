import type { ComponentProps } from "react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"

/** Footer actions share one dense size; counts may extend the square icon target. */
export function FooterAction({ icon: Icon, count = 0, iconClassName, ...props }: Omit<ComponentProps<typeof Button>, "children" | "size" | "variant"> & {
  icon: LucideIcon
  count?: number
  iconClassName?: string
}) {
  return <Button {...props} variant="ghost" size={count > 0 ? "xs" : "icon-xs"}>
    <Icon aria-hidden="true" className={iconClassName} />
    {count > 0 && <span aria-hidden="true" className="tabular-nums">{count}</span>}
  </Button>
}
