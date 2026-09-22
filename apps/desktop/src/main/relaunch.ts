import { isAbsolute } from "node:path"

export type StartupLocator = { libraryRoot: string; requireExisting: true }
const rootPrefix = "--locus-library-root="
const existingFlag = "--locus-require-existing"
export function startupLocator(args: string[]): StartupLocator | undefined {
  const roots = args.filter((arg) => arg.startsWith(rootPrefix))
  const existing = args.filter((arg) => arg === existingFlag)
  if (!roots.length && !existing.length) return undefined
  if (roots.length !== 1 || existing.length !== 1)
    throw new Error("Invalid intended-library startup arguments.")
  const libraryRoot = roots[0].slice(rootPrefix.length)
  if (!isAbsolute(libraryRoot)) throw new Error("Intended library must be an absolute path.")
  return { libraryRoot, requireExisting: true }
}
/** Only the native locator survives; renderer/run/credential state is deliberately fresh. */
export function relaunchArguments(packaged: boolean, argv: string[], libraryRoot: string) {
  if (!isAbsolute(libraryRoot)) throw new Error("Cannot restart without the resolved library root.")
  const entry = packaged ? [] : [argv.slice(1).find((value) => !value.startsWith("-"))]
  if (entry.some((value) => !value)) throw new Error("Development application entry is unavailable.")
  return [...(entry as string[]), `${rootPrefix}${libraryRoot}`, existingFlag]
}
