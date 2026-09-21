// Renderer links leave the application in the system browser. Never hand a
// captured URL to an arbitrary OS protocol handler or create a privileged window.
export function externalLinkHandler(open: (url: string) => Promise<void>) {
  return ({ url }: { url: string }) => {
    try {
      const parsed = new URL(url)
      if ((parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password) {
        void open(parsed.href).catch(() => console.warn("Could not open external link"))
      }
    } catch {
      // Malformed source links have no external navigation target.
    }
    return { action: "deny" as const }
  }
}
