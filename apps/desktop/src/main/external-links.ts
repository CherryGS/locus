import type { ExternalLinkResult } from "../shared/desktop-bridge"

// One policy for explicit native requests and ordinary window-open links.
export async function openExternalLink(value: unknown, open: (url: string) => Promise<void>): Promise<ExternalLinkResult> {
  const url = typeof value === "string" ? value : ""
  try {
    const parsed = new URL(url)
    if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password)
      return { url, status: "failed", message: "Only web addresses without credentials can be opened." }
    await open(parsed.href)
    return { url, status: "handed_off" }
  } catch {
    return { url, status: "failed", message: "The system browser handoff could not be completed." }
  }
}
export function externalLinkHandler(open: (url: string) => Promise<void>) {
  return ({ url }: { url: string }) => {
    void openExternalLink(url, open).then(result => {
      if (result.status === "failed") console.warn("Could not open external link")
    })
    return { action: "deny" as const }
  }
}
