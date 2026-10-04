import { Tabs as Primitive } from "@base-ui/react/tabs"
import { cn } from "@/shared/lib/utils"

export const Tabs = Primitive.Root
export function TabsList({ className, ...props }: Primitive.List.Props) {
  return <Primitive.List data-slot="tabs-list" className={cn("flex min-w-0 items-center gap-1 overflow-x-auto", className)} {...props} />
}
export const TabsTrigger = Primitive.Tab
