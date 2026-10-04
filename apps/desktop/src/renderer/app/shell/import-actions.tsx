import { ImportButton } from "@/features/file-import"
import { useLibraryRun } from "../providers/library-provider"
export function ImportActions() {
  const session = useLibraryRun()
  return session ? <ImportButton coordinator={session.imports} /> : null
}
