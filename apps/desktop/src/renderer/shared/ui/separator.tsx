import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"
import { cn } from "@/shared/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        // Native borders snap their stroke at fractional browser zoom. A 1px
        // background rectangle can blend over two rows at different offsets.
        "shrink-0 border-border data-horizontal:h-px data-horizontal:w-full data-horizontal:border-t data-vertical:w-px data-vertical:self-stretch data-vertical:border-l",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
