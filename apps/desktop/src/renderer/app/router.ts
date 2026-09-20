import { createHashHistory, createRouter } from "@tanstack/react-router"
import { routeTree } from "./route-tree.gen"

// Hash history also resolves routes when this isolated shell loads local assets.
export const router = createRouter({ routeTree, history: createHashHistory() })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
