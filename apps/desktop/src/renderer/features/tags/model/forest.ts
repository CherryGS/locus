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
export function forestView(records: Tag[], expanded: Set<string>, lookup: string) {
  const byId = new Map(records.map((t) => [t.id, t])),
    children = new Map<string | null, Tag[]>()
  for (const tag of records) {
    const parent = tag.parent ?? null
    const group = children.get(parent)
    if (group) group.push(tag)
    else children.set(parent, [tag])
  }
  const keep = new Set<string>(),
    query = lookup.toLocaleLowerCase()
  if (query)
    for (const tag of records)
      if (tag.name.toLocaleLowerCase().includes(query)) {
        let current: Tag | undefined = tag
        while (current && !keep.has(current.id)) {
          keep.add(current.id)
          current = current.parent ? byId.get(current.parent) : undefined
        }
      }
  const rows: { tag: Tag; depth: number; hasChildren: boolean; expanded: boolean }[] = []
  const stack = (children.get(null) ?? [])
    .slice()
    .reverse()
    .map((tag) => ({ tag, depth: 0 }))
  while (stack.length) {
    const { tag, depth } = stack.pop()!
    if (query && !keep.has(tag.id)) continue
    const branch = children.get(tag.id) ?? [],
      open = !!query || expanded.has(tag.id)
    rows.push({ tag, depth, hasChildren: !!branch.length, expanded: open })
    if (open)
      for (let i = branch.length - 1; i >= 0; i--) stack.push({ tag: branch[i], depth: depth + 1 })
  }
  return rows
}
