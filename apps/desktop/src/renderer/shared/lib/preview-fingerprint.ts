/** Byte identity supplements resource qualification; it never authorizes bytes. */
export async function previewFingerprint(bytes: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await bytes.arrayBuffer())
  return new Uint8Array(digest).join(",")
}
