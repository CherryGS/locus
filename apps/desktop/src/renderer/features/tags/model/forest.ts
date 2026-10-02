import type { Wire } from "@/shared/api"
type Tag = Wire<"TagRecord">
export function descendants(records: Tag[], root: string) {
  const children = new Map<string, string[]>()
  for (const tag of records) {
    if (!tag.parent) continue
    const branch = children.get(tag.parent)
    if (branch) branch.push(tag.id)
    else children.set(tag.parent, [tag.id])
  }
  const result = new Set<string>(),
    pending = [root]
  while (pending.length) {
    const id = pending.pop()!
    if (!result.has(id)) {
      result.add(id)
      pending.push(...(children.get(id) ?? []))
    }
  }
  return result
}
export function tagForest(records: Tag[]) {
  const byId = new Map(records.map((t) => [t.id, t])),
    children = new Map<string | null, Tag[]>(),
    counts = new Map(records.map((t) => [t.id, 0]))
  for (const tag of records) {
    const parent = tag.parent ?? null
    const group = children.get(parent)
    if (group) group.push(tag)
    else children.set(parent, [tag])
  }
  // Accumulate bottom-up once per coherent forest, without recursive depth limits.
  const order: Tag[] = [],
    pending = [...(children.get(null) ?? [])]
  while (pending.length) {
    const tag = pending.pop()!
    order.push(tag)
    for (const child of children.get(tag.id) ?? []) pending.push(child)
  }
  for (let i = order.length - 1; i >= 0; i--) {
    const tag = order[i]
    if (tag.parent) counts.set(tag.parent, counts.get(tag.parent)! + counts.get(tag.id)! + 1)
  }
  return { byId, children, counts }
}
export type TagForest = ReturnType<typeof tagForest>

export function tagPath(forest: TagForest, id?: string) {
  const path: Tag[] = []
  let tag = id ? forest.byId.get(id) : undefined
  while (tag) {
    path.push(tag)
    tag = tag.parent ? forest.byId.get(tag.parent) : undefined
  }
  return path.reverse()
}

export function tagColumns(forest: TagForest, id?: string) {
  const path = tagPath(forest, id),
    columns = [{ parent: null as Tag | null, tags: forest.children.get(null) ?? [] }]
  for (const tag of path) {
    const tags = forest.children.get(tag.id) ?? []
    if (tags.length) columns.push({ parent: tag, tags })
  }
  return { path, columns }
}
