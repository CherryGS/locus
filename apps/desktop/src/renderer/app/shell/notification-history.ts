import type { ToastObject } from "@base-ui/react/toast"

export type Notification = Pick<ToastObject<object>, "id" | "title" | "description" | "type"> & {
  receivedAt: number
  unread: boolean
}
export type NotificationHistory = {
  records: Notification[]
  observed: Map<string, number>
}

export function collectNotifications(
  history: NotificationHistory,
  toasts: ToastObject<object>[],
  open: boolean,
  now = Date.now(),
): NotificationHistory {
  const observed = new Map<string, number>()
  let records = history.records
  for (const item of [...toasts].reverse()) {
    const revision = item.updateKey ?? 0
    observed.set(item.id, revision)
    // Closing/animation changes must not restore a cleared notification.
    if (item.transitionStatus === "ending" || history.observed.get(item.id) === revision) continue
    records = [
      {
        id: item.id,
        title: item.title,
        description: item.description,
        type: item.type,
        receivedAt: now,
        unread: !open,
      },
      ...records.filter((record) => record.id !== item.id),
    ]
  }
  return { records, observed }
}
