import { ImportButton } from "@/features/file-import"
import { useLibrarySession } from "../providers/library-provider"
export function ImportActions() {
  const session = useLibrarySession()
  return session ? <ImportButton coordinator={session.imports} /> : null
}
