import { createMemoryHistory, createRouter } from "@tanstack/react-router"
import { routeTree } from "./route-tree.gen"

export function createPageRouter(entry = "/entity?mode=grid&collectionId=library") {
  return createRouter({ routeTree, history: createMemoryHistory({ initialEntries: [entry] }) })
}
export type PageRouter = ReturnType<typeof createPageRouter>
declare module "@tanstack/react-router" {
  interface Register { router: PageRouter }
}
