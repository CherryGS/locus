import { createContext, useContext, type ReactNode } from "react"
import { createPortal } from "react-dom"

// The reading view keeps ownership of its selection and operations. This slot
// changes their presentation location without duplicating reads or UI state.
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
