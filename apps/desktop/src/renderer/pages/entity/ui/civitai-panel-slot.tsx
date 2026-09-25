import { createContext, useContext, type ReactNode } from "react"
import { createPortal } from "react-dom"

// Reading state stays in the page; the Entity panel only provides its UI slot.
export const CivitaiPanelContext = createContext<{
  target: HTMLDivElement | null
  open: () => void
} | null>(null)

export function useCivitaiPanel() {
  return useContext(CivitaiPanelContext)
}

export function CivitaiPanelPortal({ children }: { children: ReactNode }) {
  const panel = useCivitaiPanel()
  return panel?.target ? createPortal(children, panel.target) : null
}
