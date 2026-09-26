// Preview-only entry, injected by notification-preview-renderer.ts. Never imported by the app.
import { createRoot } from "react-dom/client"
import { Button } from "../src/renderer/shared/ui/button"
import { toast } from "../src/renderer/shared/ui/toast"

let progressTimer: number | undefined
function showExamples() {
  window.clearTimeout(progressTimer)
  toast.add({
    id: "example-success",
    title: "Example · Import complete",
    description: "3 images have been added to your library.",
    type: "success",
  })
  toast.add({
    id: "example-info",
    title: "Example · Address copied",
    description: "You can paste it into your browser extension.",
    type: "info",
  })
  toast.add({
    id: "example-warning",
    title: "Example · Some previews are unavailable",
    description:
      "The original files are still in your library. Two video previews could not be generated; check your media tool paths in Settings before trying again.",
    type: "warning",
  })
  toast.add({
    id: "example-error",
    title: "Example · Couldn't open link",
    description: "The system browser did not respond. You can try opening the link again.",
    type: "error",
    timeout: 15000,
    actionProps: {
      children: "Try again",
      onClick: () => {
        toast.close("example-error")
        toast.add({
          title: "Example · Retry requested",
          description: "This is a UI demonstration; no link was opened.",
          type: "info",
        })
      },
    },
  })
  toast.add({
    id: "example-progress",
    title: "Example · Creating previews",
    description: "Processing 3 images…",
    type: "loading",
    timeout: 0,
  })
  progressTimer = window.setTimeout(
    () =>
      toast.update("example-progress", {
        title: "Example · Previews ready",
        description: "All 3 image previews are ready to view.",
        type: "success",
        timeout: 5000,
      }),
    6000,
  )
}

const controls = document.createElement("aside")
controls.setAttribute("aria-label", "Notification examples")
// Keep the demonstrator outside the actual app and away from its notification corner.
Object.assign(controls.style, { position: "fixed", left: "64px", bottom: "44px", zIndex: "10" })
document.body.append(controls)
createRoot(controls).render(
  <div className="flex items-center gap-3 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md">
    <span className="text-xs text-muted-foreground">Notification examples</span>
    <Button size="sm" variant="outline" onClick={showExamples}>
      Show examples
    </Button>
  </div>,
)
