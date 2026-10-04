import { Menu } from "@base-ui/react/menu"
import { cn } from "@/shared/lib/utils"

export const DropdownMenu = Menu.Root
export const DropdownMenuTrigger = Menu.Trigger
export const DropdownMenuGroup = Menu.Group
export function DropdownMenuContent({ className, children, ...props }: Menu.Popup.Props) {
  return <Menu.Portal><Menu.Positioner side="bottom" align="start" sideOffset={4} className="isolate z-50 outline-none">
    <Menu.Popup data-slot="dropdown-menu-content" className={cn("min-w-48 rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none", className)} {...props}>{children}</Menu.Popup>
  </Menu.Positioner></Menu.Portal>
}
export function DropdownMenuItem({ className, ...props }: Menu.Item.Props) {
  return <Menu.Item data-slot="dropdown-menu-item" className={cn("flex cursor-default items-center rounded-md px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-50", className)} {...props} />
}
export function DropdownMenuSeparator(props: Menu.Separator.Props) { return <Menu.Separator className="my-1 border-t border-border" {...props} /> }
