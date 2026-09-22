import { createContext, useContext, useLayoutEffect, type Dispatch, type SetStateAction } from "react"

export const SourceReturnContext = createContext<{
  action?: () => void
  setAction: Dispatch<SetStateAction<(() => void) | undefined>>
}>({ setAction: () => {} })

// Shell owns placement; only the active page supplies navigation meaning.
export function useSourceReturn(action: (() => void) | undefined) {
  const { setAction } = useContext(SourceReturnContext)
  useLayoutEffect(() => {
    setAction(() => action)
    return () => setAction(undefined)
  }, [action, setAction])
}
