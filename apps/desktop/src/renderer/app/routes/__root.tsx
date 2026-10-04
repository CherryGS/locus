import { createRootRoute, Outlet } from "@tanstack/react-router"
import { PageChrome } from "../shell/page-chrome"
export const Route = createRootRoute({ component: () => <PageChrome><Outlet /></PageChrome> })
