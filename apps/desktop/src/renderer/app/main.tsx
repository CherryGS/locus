import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { RouterProvider } from "@tanstack/react-router"
import { EntitySelectionProvider } from "@/features/entity-selection"
import { router } from "./router"
import "./styles.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <EntitySelectionProvider>
      <RouterProvider router={router} />
    </EntitySelectionProvider>
  </StrictMode>,
)
