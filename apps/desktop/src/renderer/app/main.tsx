import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { NotificationProvider } from "./shell/notification-provider"
import { DesktopShell } from "./shell/desktop-shell"
import { LibraryProvider } from "./providers/library-provider"
import "./styles.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LibraryProvider>
      <NotificationProvider>
        <DesktopShell />
      </NotificationProvider>
    </LibraryProvider>
  </StrictMode>,
)
