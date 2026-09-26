import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"
import { NotificationProvider } from "./shell/notification-provider"
import { router } from "./router"
import { LibraryProvider } from "./providers/library-provider"
import "./styles.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LibraryProvider>
      <NotificationProvider>
        <RouterProvider router={router} />
      </NotificationProvider>
    </LibraryProvider>
  </StrictMode>,
)
