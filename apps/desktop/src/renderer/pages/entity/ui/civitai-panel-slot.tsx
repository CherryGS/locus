import { createContext, useContext, type ReactNode } from "react"
import { createPortal } from "react-dom"

// Reading state stays in the page; the Entity panel only provides its UI slot.
export const CivitaiPanelContext = createContext<{
  target: HTMLDivElement | null
} | null>(null)

export function CivitaiPanelPortal({ children }: { children: ReactNode }) {
  const panel = useContext(CivitaiPanelContext)
  return panel?.target ? createPortal(children, panel.target) : null
}
