import { open, realpath, mkdir, rename, readFile, writeFile, unlink } from "node:fs/promises"
import type { LibrarySource } from "../shared/desktop-bridge"
import type { StartupLocator } from "./relaunch"
import { homedir } from "node:os"
import { dirname, isAbsolute, join } from "node:path"
import { randomUUID } from "node:crypto"

export function displayLibraryPath(root: string) {
  return process.platform === "win32" ? root.replace(/^\\\\\?\\UNC\\/, "\\\\").replace(/^\\\\\?\\/, "") : root
}

// Matches the backend's BaseDirs::data_local_dir()/Locus/path locator.
export function libraryPathFile() {
  const base =
    process.platform === "win32"
      ? (process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"))
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Application Support")
        : process.env.XDG_DATA_HOME || join(homedir(), ".local", "share")
  if (!isAbsolute(base)) throw new Error("The application-data directory must be an absolute path.")
  return join(base, "Locus", "path")
}

/** Capture startup precedence before rememberLibrary can update the locator. */
export async function librarySource(
  locator?: StartupLocator,
  environment: string | null | undefined = process.env.LOCUS_DATA_DIR,
  file?: string,
): Promise<LibrarySource | undefined> {
  if (locator) return { kind: locator.remember ? "selection" : "startup" }
  if (environment != null) return { kind: "environment", name: "LOCUS_DATA_DIR" }
  try {
    file ??= libraryPathFile()
    const firstLine = (await readFile(file, "utf8"))
      .split(/\r?\n/, 1)[0]
      .replace(/^\uFEFF/, "")
      .trim()
    return firstLine ? { kind: "path-file", name: file } : { kind: "default" }
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? { kind: "default" } : undefined
  }
}

export async function existingLibrary(path: string) {
  if (!isAbsolute(path) || /[\r\n]/.test(path)) throw new Error("Choose an absolute library folder path.")
  const root = await realpath(path)
  const database = await open(join(root, "metadata.sqlite"), "r").catch(() => {
    throw new Error("Choose an existing Locus library folder containing metadata.sqlite.")
  })
  try {
    const header = Buffer.alloc(16)
    await database.read(header, 0, header.length, 0)
    if (header.toString() !== "SQLite format 3\0")
      throw new Error("This folder does not contain a readable library database.")
  } finally {
    await database.close()
  }
  // The backend still owns schema compatibility and exclusive library use.
  return root
}

export async function rememberLibrary(root: string, file = libraryPathFile()) {
  if (!isAbsolute(root) || /[\r\n]/.test(root)) throw new Error("Invalid library locator.")
  await mkdir(dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${displayLibraryPath(root)}\n`, { flag: "wx" })
    await rename(temporary, file)
  } finally {
    await unlink(temporary).catch(() => {})
  }
}
