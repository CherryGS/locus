import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import {
  ToastProvider,
  ToastPortal,
  ToastViewport,
  ToastList,
  toast,
  useToastManager,
} from "@/shared/ui/toast"
import { collectNotifications, type NotificationHistory, type Notification } from "./notification-history"

type NotificationContextValue = {
  records: Notification[]
  open: boolean
  setOpen: (open: boolean) => void
  remove: (id: string) => void
  clear: () => void
}
const NotificationContext = createContext<NotificationContextValue | null>(null)

export function NotificationProvider({ children }: { children: ReactNode }) {
  return (
    <ToastProvider toastManager={toast}>
      <NotificationState>{children}</NotificationState>
    </ToastProvider>
  )
}

function NotificationState({ children }: { children: ReactNode }) {
  const { toasts, close } = useToastManager()
  const [open, setOpen] = useState(false)
  const [history, setHistory] = useState<NotificationHistory>(() => ({ records: [], observed: new Map() }))
  useEffect(() => {
    setHistory((previous) => collectNotifications(previous, toasts, open))
  }, [toasts, open])
  const changeOpen = (value: boolean) => {
    setOpen(value)
    if (value)
      setHistory((previous) => ({
        ...previous,
        records: previous.records.map((item) => ({ ...item, unread: false })),
      }))
  }
  return (
    <NotificationContext.Provider
      value={{
        records: history.records,
        open,
        setOpen: changeOpen,
        remove: (id) => {
          close(id)
          setHistory((previous) => ({
            ...previous,
            records: previous.records.filter((item) => item.id !== id),
          }))
        },
        clear: () => {
          close()
          setHistory((previous) => ({ ...previous, records: [] }))
        },
      }}
    >
      {children}
      <ToastPortal>
        <ToastViewport
          className="bottom-11"
          inert={open}
          aria-hidden={open || undefined}
          style={open ? { visibility: "hidden" } : undefined}
        >
          <ToastList />
        </ToastViewport>
      </ToastPortal>
    </NotificationContext.Provider>
  )
}

export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) throw new Error("Notifications require NotificationProvider")
  return context
}
