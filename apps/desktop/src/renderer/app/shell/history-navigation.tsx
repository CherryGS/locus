import { useEffect } from "react"
import { useRouter } from "@tanstack/react-router"
import { ArrowLeftIcon, ArrowRightIcon } from "lucide-react"
import { Button } from "@/shared/ui/button"

export function HistoryNavigation() {
  const router = useRouter()

  useEffect(() => {
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
  }, [router])

  return (
    <nav aria-label="History" className="flex items-center gap-0.5">
      <Button variant="ghost" size="icon-sm" aria-label="Back" title="Back (Alt+←)" onClick={() => router.history.back()}>
        <ArrowLeftIcon data-icon="inline-start" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label="Forward" title="Forward (Alt+→)" onClick={() => router.history.forward()}>
        <ArrowRightIcon data-icon="inline-start" />
      </Button>
    </nav>
  )
}
