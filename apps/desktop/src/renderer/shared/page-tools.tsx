import { createContext, useContext, type RefCallback } from "react"

/** Pages provide a local placement for their browsing status. */
export const HeaderPlacementContext = createContext<RefCallback<HTMLDivElement> | undefined>(undefined)
export function HeaderDisplayPlacement() {
  const ref = useContext(HeaderPlacementContext)
  return <div ref={ref} data-slot="header-display" className="w-36 shrink-0 truncate text-xs tabular-nums text-muted-foreground max-sm:sr-only" />
}
