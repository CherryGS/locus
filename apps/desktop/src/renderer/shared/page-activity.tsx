import { createContext, useContext } from "react"
export const PageActivityContext = createContext({ active: true, requestClose: () => {} })
export const usePageActivity = () => useContext(PageActivityContext)
