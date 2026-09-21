/** Compact backend sequences and explicit preview sequences share indexed access.
 * No whole-library map/string expansion is needed for content or navigation. */
export interface IdentitySequence {
  readonly length: number
  readonly byteLength?: number
  at(index: number): string | undefined
  indexOf(id: string): number
}
export function suppliedSequence(ids: readonly string[]): IdentitySequence {
  return { length: ids.length, at: (index) => ids[index], indexOf: (id) => ids.indexOf(id) }
}
export const emptySequence = suppliedSequence([])
export type EntitySource = {
  sequence: IdentitySequence
  get(id: string): import("./entity-item").EntityItem
  demand(ids: string[]): void
}
