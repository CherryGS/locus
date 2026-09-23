import type { Availability } from "../shared/desktop-bridge"
import type { StartupLocator } from "./relaunch"
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { randomBytes } from "node:crypto"
import { access } from "node:fs/promises"
import { isAbsolute, join, resolve } from "node:path"
import { createInterface } from "node:readline"

export type Backend = {
  child: ChildProcessWithoutNullStreams
  origin: string
  runId: string
  availability: Availability
  libraryRoot: string
  credential: string
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
}

export async function launchBackend(
  onSpawn: (child: ChildProcessWithoutNullStreams) => void,
  signal?: AbortSignal,
  locator?: StartupLocator
): Promise<Backend> {
  signal?.throwIfAborted()
  const root = resolve(import.meta.dirname, "../../../..")
  const binary =
    process.env.LOCUS_SERVER_BINARY ??
    join(root, "target/debug", process.platform === "win32" ? "locus-server.exe" : "locus-server")
  const renderer = process.env.LOCUS_RENDERER_ROOT ?? resolve(import.meta.dirname, "../renderer")
  if (!isAbsolute(binary) || !isAbsolute(renderer))
    throw new Error("Backend and renderer overrides must be absolute paths.")
  await access(binary).catch(() => {
    throw new Error("The built backend is missing. Run just server-build before opening Locus.")
  })
  await access(join(renderer, "index.html")).catch(() => {
    throw new Error("The built renderer is missing. Run just desktop-build before opening Locus.")
  })
  signal?.throwIfAborted()
  const credential = randomBytes(32).toString("hex")
  const child = spawn(binary, [], { stdio: "pipe", windowsHide: true })
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => {
    child.once("exit", (code, signal) => done({ code, signal }))
    child.once("error", () => done({ code: null, signal: null }))
  })
  onSpawn(child)
  const abort = () => {
    child.kill()
  }
  signal?.addEventListener("abort", abort, { once: true })
  // Do not forward server output: the native error surface reports bounded reasons
  // and the private readiness channel must never become a credential/log channel.
  child.stderr.resume()
  child.stdin.end(
    JSON.stringify({
      credential,
      library_root: locator?.libraryRoot ?? process.env.LOCUS_DATA_DIR ?? null,
      require_existing: locator?.requireExisting ?? false,
      renderer_root: renderer,
    })
  )
  try {
    const ready = await new Promise<{
      origin: string
      runId: string
      libraryRoot: string
      availability: Availability
    }>((done, fail) => {
      const lines = createInterface({ input: child.stdout })
      const timer = setTimeout(() => finish(new Error("Backend startup did not report readiness.")), 30_000)
      const finish = (
        error?: Error,
        value?: { origin: string; runId: string; libraryRoot: string; availability: Availability }
      ) => {
        clearTimeout(timer)
        lines.close()
        child.off("error", onError)
        child.off("close", onExit)
        if (error) fail(error)
        else done(value!)
      }
      const onError = () => finish(new Error("Unable to start the backend process."))
      const onExit = () =>
        finish(
          new Error(
            "The backend stopped before startup completed. Check the selected library and built artifacts."
          )
        )
      child.once("error", onError)
      // close follows stdout draining, so a short failure record cannot lose a
      // race with process exit and become an invented generic startup failure.
      child.once("close", onExit)
      lines.once("line", (line) => {
        try {
          if (line.length > 4096) throw new Error()
          const value = JSON.parse(line) as {
            startup_error?: unknown
            origin?: unknown
            run_id?: unknown
            library_root?: unknown
            availability?: Availability
          }
          if ("startup_error" in value) {
            if (value.startup_error === "library_in_use" && Object.keys(value).length === 1) {
              finish(new Error("This library is already open in another Locus backend. Close that backend, then choose Retry."))
              return
            }
            throw new Error()
          }
          if (
            typeof value.origin !== "string" ||
            typeof value.run_id !== "string" ||
            typeof value.library_root !== "string" ||
            !isAbsolute(value.library_root) ||
            !value.availability ||
            !["normal", "restricted"].includes(value.availability.status) ||
            (value.availability.status === "restricted" && typeof value.availability.message !== "string")
          )
            throw new Error()
          const url = new URL(value.origin)
          if (
            url.protocol !== "http:" ||
            url.hostname !== "127.0.0.1" ||
            !url.port ||
            url.origin !== value.origin ||
            !/^[0-9a-f-]{36}$/.test(value.run_id)
          )
            throw new Error()
          finish(undefined, {
            origin: value.origin,
            runId: value.run_id,
            libraryRoot: value.library_root,
            availability: value.availability,
          })
        } catch {
          finish(new Error("The backend supplied invalid readiness information."))
        }
      })
    })
    const status = (await fetch(`${ready.origin}/api/v1/server`, {
      headers: { Authorization: `Bearer ${credential}`, "X-Locus-Run": ready.runId },
      redirect: "error",
      signal,
    }).then((response) => response.json())) as {
      run_id?: string
      admission?: string
      availability?: Availability
    }
    if (
      status.run_id !== ready.runId ||
      status.admission !== "open" ||
      JSON.stringify(status.availability) !== JSON.stringify(ready.availability)
    )
      throw new Error("Backend readiness could not be verified.")
    signal?.removeEventListener("abort", abort)
    return { child, credential, exited, ...ready }
  } catch (error) {
    if (child.exitCode === null && child.signalCode === null) child.kill()
    await exited
    throw error
  } finally {
    signal?.removeEventListener("abort", abort)
  }
}

export async function drainBackend(backend: Backend) {
  const response = await fetch(`${backend.origin}/api/v1/drain`, {
    method: "POST",
    redirect: "error",
    headers: { Authorization: `Bearer ${backend.credential}`, "X-Locus-Run": backend.runId },
  })
  if (!response.ok) throw new Error("The backend could not begin accepted-work drain.")
  return response.json() as Promise<{ active_operations: string }>
}
