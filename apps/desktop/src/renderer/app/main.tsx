import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"
import { Toaster } from "@/shared/ui/toast"
import { router } from "./router"
import { LibraryProvider } from "./providers/library-provider"
import "./styles.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LibraryProvider>
      <RouterProvider router={router} />
      <Toaster />
    </LibraryProvider>
  </StrictMode>
)
