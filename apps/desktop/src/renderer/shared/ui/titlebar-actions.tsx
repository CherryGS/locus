import { createContext, useContext, type ReactNode } from "react"
import { createPortal } from "react-dom"

export const TitlebarActionsTarget = createContext<HTMLElement | null>(null)

// The page retains its action and state; only its visual placement moves into
// the shell. Unmounting the page also removes its titlebar controls.
export function TitlebarActions({ children }: { children: ReactNode }) {
  const target = useContext(TitlebarActionsTarget)
  return target ? createPortal(children, target) : null
}
