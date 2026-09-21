export type RequestContext = {
  url: string
  mainFrame: boolean
  ownedWindow: boolean
  frameOrigin?: string
  initiatorOrigin?: string
  resourceType: string
  redirected: boolean
}

export function isRendererPage(url: string, origin: string) {
  try {
    const value = new URL(url)
    return value.origin === origin && (value.pathname === "/" || value.pathname === "/index.html")
  } catch {
    return false
  }
}

/** A redirect never gains a grant. Only the explicitly loaded page may bootstrap
 * before its frame has the backend origin; all other requests need that frame. */
export function authorizedHeaders(
  context: RequestContext,
  origin: string,
  runId: string,
  credential: string,
  headers: Record<string, string>
) {
  const clean = Object.fromEntries(Object.entries(headers).filter(([key]) => key.toLowerCase() !== "authorization"))
  let target: URL
  try {
    target = new URL(context.url)
  } catch {
    return { cancel: true, requestHeaders: clean }
  }
  const bootstrap = context.resourceType === "mainFrame" && isRendererPage(context.url, origin)
  const allowed =
    context.ownedWindow &&
    context.mainFrame &&
    !context.redirected &&
    target.origin === origin &&
    (!context.initiatorOrigin || context.initiatorOrigin === origin) &&
    (bootstrap || context.frameOrigin === origin)
  if (!allowed) return { cancel: true, requestHeaders: clean }
  clean.Authorization = `Bearer ${credential}`
  // Explicit caller run context is never rewritten, including an obsolete run.
  if (!Object.keys(clean).some((key) => key.toLowerCase() === "x-locus-run")) clean["X-Locus-Run"] = runId
  return { requestHeaders: clean }
}
