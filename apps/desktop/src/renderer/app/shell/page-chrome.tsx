import { useContext, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { useRouter, useRouterState } from "@tanstack/react-router"
import { BrowsingHistoryBinding } from "./settings-navigation"
import { HistoryNavigation, HistoryPlacementContext } from "./history-navigation"
import { HeaderDisplayContext } from "@/shared/ui/header-display"
import { SourceReturnContext } from "@/shared/source-return"
import { HeaderPlacementContext } from "@/shared/page-tools"
import { usePageActivity } from "@/shared/page-activity"

export function PageChrome({ children }: { children: ReactNode }) {
  const { active } = usePageActivity()
  const navigation = useContext(HistoryPlacementContext)
  const router = useRouter()
  const location = useRouterState({ select: state => state.location })
  const [action, setAction] = useState<(() => void) | undefined>()
  const [header, setHeader] = useState<HTMLDivElement | null>(null)
  return <SourceReturnContext.Provider value={{ action, setAction }}>
    <HeaderDisplayContext value={header}>
      <BrowsingHistoryBinding />
      {active && navigation && createPortal(<HistoryNavigation />, navigation)}
      <HeaderPlacementContext value={setHeader}>
        <div className="h-full min-h-0" data-page-location={location.href} data-history-index={location.state.__TSR_index} data-history-length={router.history.length}>{children}</div>
      </HeaderPlacementContext>
    </HeaderDisplayContext>
  </SourceReturnContext.Provider>
}
