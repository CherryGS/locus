import { createContext, useContext, type ReactNode } from "react"
import { createPortal } from "react-dom"

/** The active page owns display content; the shell only provides its placement. */
export const HeaderDisplayContext = createContext<HTMLDivElement | null>(null)
export function HeaderDisplay({ children }: { children: ReactNode }) {
  const target = useContext(HeaderDisplayContext)
  return target ? createPortal(children, target) : null
}
