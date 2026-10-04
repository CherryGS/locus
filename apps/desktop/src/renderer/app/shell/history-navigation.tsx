import { createContext, useContext, useEffect } from "react"
import { useRouter } from "@tanstack/react-router"
import { ArrowLeftIcon, ArrowRightIcon, CornerDownLeftIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"

import { usePageActivity } from "@/shared/page-activity"
import { SourceReturnContext } from "@/shared/source-return"

export const HistoryPlacementContext = createContext<HTMLDivElement | null>(null)

export function HistoryNavigation() {
  const { action } = useContext(SourceReturnContext)
  const router = useRouter()
  const { active } = usePageActivity()

  useEffect(() => {
    if (!active) return
    function navigate(event: KeyboardEvent) {
      if (event.defaultPrevented || document.querySelector('[data-slot="dialog-content"][data-open]')) return
      const backwards = (event.key === "ArrowLeft" && event.altKey) || (event.key === "[" && event.metaKey)
      const forwards = (event.key === "ArrowRight" && event.altKey) || (event.key === "]" && event.metaKey)
      if (!backwards && !forwards) return
      event.preventDefault()
      backwards ? router.history.back() : router.history.forward()
    }
    window.addEventListener("keydown", navigate)
    return () => window.removeEventListener("keydown", navigate)
  }, [router, active])

  return (
    <nav aria-label="History" className="flex items-center gap-0.5">
      <Button variant="ghost" size="icon-sm" aria-label="Back" title="Back (Alt+←)" onClick={() => router.history.back()}>
        <ArrowLeftIcon data-icon="inline-start" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Forward" title="Forward (Alt+→)" onClick={() => router.history.forward()}>
        <ArrowRightIcon data-icon="inline-start" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Return to source" title="Return to source (Esc)" disabled={!action} onClick={action}>
        <CornerDownLeftIcon data-icon="inline-start" />
      </Button>
    </nav>
  )
}
