import { createContext, useContext, type ReactNode, type RefCallback } from "react"

/** App adapters inject page navigation into each feature's existing toolbar. */
export const PageToolsContext = createContext<ReactNode>(null)
export const HeaderPlacementContext = createContext<RefCallback<HTMLDivElement> | undefined>(undefined)
export function PageTools() { return useContext(PageToolsContext) }
export function HeaderDisplayPlacement() {
  const ref = useContext(HeaderPlacementContext)
  return <div ref={ref} data-slot="header-display" className="w-36 shrink-0 truncate text-xs tabular-nums text-muted-foreground max-sm:sr-only" />
}
