import { useEffect, useState } from "react"

/** Defer visual busy feedback, never the operation or its completion. */
export function useDelayedPending(pending: boolean, delay = 150) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!pending) {
      setVisible(false)
      return
    }
    const timer = setTimeout(() => setVisible(true), delay)
    return () => clearTimeout(timer)
  }, [pending, delay])
  return pending && visible
}
