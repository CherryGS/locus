import assert from "node:assert/strict"
import { test } from "node:test"
import { TagCoordinator } from "../src/renderer/features/tags/model/tag-coordinator.ts"
import { TagBrowsing } from "../src/renderer/features/tags/model/tag-browsing.ts"
import {
  tagForest,
  tagPath,
  tagColumns,
  descendants,
} from "../src/renderer/features/tags/model/forest.ts"
const tick = () => new Promise((resolve) => setImmediate(resolve))
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const tag = (id, parent = null) => ({ id, name: id, parent, revision: "one" })
function setup(overrides = {}) {
  const tags = new TagCoordinator(
    {
      tags: async () => [tag("root"), tag("child", "root")],
      tagWrite: async () => ({ status: "tag_deleted", id: "root" }),
      ...overrides,
    },
    "run",
    () => {},
  )
  const requests = []
  const browser = new TagBrowsing(
    {
      filterLanguage: async () => ({ format: "native", version: 2 }),
      filterLiteral: async (input) => {
        requests.push(input)
        return { condition: `${input.field}:"${input.value.value}"` }
      },
      ...overrides,
    },
    tags,
  )
  return { tags, browser, requests }
}
test("column paths switch branches, omit empty leaf columns and count descendants excluding self", () => {
  const records = [
      tag("root"),
      tag("middle", "root"),
      tag("leaf", "middle"),
      tag("sibling", "root"),
      tag("other"),
    ],
    forest = tagForest(records)
  const columns = (id) => tagColumns(forest, id).columns.map((c) => c.tags.map((t) => t.id))
  assert.deepEqual(columns(), [["root", "other"]])
  assert.deepEqual(columns("middle"), [["root", "other"], ["middle", "sibling"], ["leaf"]])
  assert.deepEqual(columns("leaf"), columns("middle"))
  assert.deepEqual(columns("sibling"), [
    ["root", "other"],
    ["middle", "sibling"],
  ])
  assert.deepEqual(columns("other"), [["root", "other"]])
  assert.deepEqual(columns("missing"), [["root", "other"]])
  assert.deepEqual(
    tagPath(forest, "leaf").map((t) => t.id),
    ["root", "middle", "leaf"],
  )
  assert.equal(forest.children.get("root").length, 2)
  assert.equal(forest.counts.get("root"), 3)
  assert.equal(forest.counts.get("middle"), 1)
  assert.equal(forest.counts.get("leaf"), 0)
  assert.deepEqual([...descendants(records, "middle")], ["middle", "leaf"])
  records.find((t) => t.id === "middle").parent = "other"
  const moved = tagForest(records)
  assert.deepEqual(
    tagPath(moved, "leaf").map((t) => t.id),
    ["other", "middle", "leaf"],
  )
  assert.equal(moved.counts.get("root"), 1)
  assert.equal(moved.counts.get("other"), 2)
  const deep = Array.from({ length: 3000 }, (_, i) => tag(String(i), i ? String(i - 1) : null))
  const deepForest = tagForest(deep)
  assert.equal(tagPath(deepForest, "2999").length, 3000)
  assert.equal(deepForest.counts.get("0"), 2999)
  assert.equal(tagColumns(deepForest, "2999").columns.length, 3000)
})
test("management navigation survives suspension and absent reads; confirmed deletion clears selection", async () => {
  const { tags, browser } = setup()
  browser.select("root")
  browser.find("child")
  browser.scrollLeft = 240
  browser.columnScroll.set("roots", 420)
  browser.columnScroll.set("root", 120)
  browser.suspend()
  assert.equal(browser.tagId, "root")
  assert.equal(browser.lookup, "child")
  assert.equal(browser.scrollLeft, 240)
  assert.equal(browser.columnScroll.get("roots"), 420)
  assert.equal(browser.columnScroll.get("root"), 120)
  tags.vocabulary = []
  await tags.read()
  assert.equal(browser.tagId, "root")
  await tags.write({ operation: "delete", id: "root", revision: "one" }, "delete")
  assert.equal(browser.tagId, undefined)
  assert.equal(browser.columnScroll.get("roots"), 420)
  browser.dispose()
})
test("ancestor location retains the open branch; only choosing a different branch replaces it", async () => {
  let records = [
    tag("root"),
    tag("middle", "root"),
    tag("leaf", "middle"),
    tag("sibling", "root"),
    tag("other"),
  ]
  const { tags, browser } = setup({
    tags: async () => records,
    tagWrite: async ({ change }) => {
      records = records.filter((t) => t.id !== change.id)
      records.find((t) => t.id === "leaf").parent = "root"
      return { status: "tag_deleted", id: change.id }
    },
  })
  await tags.read()
  browser.locate("leaf")
  browser.locate("root")
  assert.equal(browser.tagId, "root")
  assert.equal(browser.branchId, "leaf")
  assert.equal(tagColumns(tagForest(records), browser.branchId).columns.length, 3)
  browser.locate("middle")
  browser.locate("root")
  browser.suspend()
  assert.equal(browser.branchId, "leaf")
  browser.revealSelection = false
  browser.locate("root")
  assert(browser.revealSelection)
  assert.equal(browser.branchId, "leaf")
  browser.locate("sibling")
  assert.equal(browser.branchId, "sibling")
  assert.equal(tagColumns(tagForest(records), browser.branchId).columns.length, 2)
  browser.locate("other")
  assert.equal(browser.branchId, "other")
  browser.locate("leaf")
  browser.locate("middle")
  await tags.write({ operation: "delete", id: "middle", revision: "one" }, "delete")
  await tick()
  assert.equal(browser.tagId, undefined)
  assert.equal(browser.branchId, "leaf")
  assert.deepEqual(
    tagPath(tagForest(records), browser.branchId).map((t) => t.id),
    ["root", "leaf"],
  )
  browser.dispose()
  tags.dispose()
})
test("generation hands off generated stable source and never queries a private Entity result", async () => {
  const { browser, requests } = setup()
  let received,
    navigated = 0
  browser.select("child")
  await browser.content(
    true,
    {
      generatedDraftReceiver: () => (source) => {
        received = source
        return true
      },
    },
    () => navigated++,
  )
  assert.equal(requests[0].field, "tag_subtree")
  assert.equal(received.text, 'tag_subtree:"child"')
  assert.equal(navigated, 1)
  await browser.content(
    false,
    {
      generatedDraftReceiver: () => (source) => {
        received = source
        return true
      },
    },
    () => navigated++,
  )
  assert.equal(received.text, 'tag_ids:"child"')
  browser.dispose()
})
test("busy, failed, departed, superseded and disposed generation preserve management", async () => {
  for (const abandon of [(b) => b.suspend(), (b) => b.select("other"), (b) => b.dispose()]) {
    const pending = deferred(),
      { browser } = setup({ filterLiteral: () => pending.promise })
    let calls = 0
    browser.select("root")
    const work = browser.content(
      true,
      {
        generatedDraftReceiver: () => () => {
          calls++
          return true
        },
      },
      () => calls++,
    )
    await tick()
    abandon(browser)
    pending.resolve({ condition: "new" })
    await work
    assert.equal(calls, 0)
  }
  const { browser } = setup({
    filterLiteral: async () => {
      throw new Error("generation failed")
    },
  })
  browser.select("root")
  await browser.content(true, { generatedDraftReceiver: () => undefined }, () => assert.fail())
  assert.match(browser.error, /busy/)
  await browser.content(true, { generatedDraftReceiver: () => () => true }, () => assert.fail())
  assert.match(browser.error, /generation failed/)
  assert.equal(browser.tagId, "root")
  browser.dispose()
})
test("a read started before a write cannot replace newer vocabulary", async () => {
  const old = deferred(),
    write = deferred()
  let reads = 0
  const { tags } = setup({
    tags: () => (++reads === 1 ? old.promise : Promise.resolve([tag("new")])),
    tagWrite: () => write.promise,
  })
  const reading = tags.read(),
    writing = tags.write({ operation: "create", name: "new" }, "create")
  old.resolve([tag("old")])
  await reading
  assert.equal(tags.vocabulary, undefined)
  write.resolve({ status: "tag_saved", tag: tag("new") })
  await writing
  await tick()
  assert.equal(tags.vocabulary[0].id, "new")
  tags.dispose()
})
