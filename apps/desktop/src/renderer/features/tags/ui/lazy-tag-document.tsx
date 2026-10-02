import { lazy, Suspense } from "react"
import { Spinner } from "@/shared/ui/spinner"
import type { TagDetails, TagDetailState } from "../model/tag-detail"

// Load rich editing only when its document area is visited.
const Document = lazy(() =>
  import("./tag-document").then((module) => ({ default: module.TagDocument })),
)
export function TagDocument(props: { coordinator: TagDetails; state: TagDetailState }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <Spinner />
        </div>
      }
    >
      <Document {...props} />
    </Suspense>
  )
}
