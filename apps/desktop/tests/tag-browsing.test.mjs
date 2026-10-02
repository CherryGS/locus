import assert from "node:assert/strict"
import { test } from "node:test"
import { TagCoordinator } from "../src/renderer/features/tags/model/tag-coordinator.ts"
import { TagBrowsing } from "../src/renderer/features/tags/model/tag-browsing.ts"
import { forestView, descendants } from "../src/renderer/features/tags/model/forest.ts"
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
test("forest lookup retains ancestors, arbitrary-depth iteration and branch navigation", () => {
  const records = [tag("root"), tag("middle", "root"), tag("leaf", "middle"), tag("other")]
  assert.deepEqual(
    forestView(records, new Set(), "").map((r) => r.tag.id),
    ["root", "other"],
  )
  assert.deepEqual(
    forestView(records, new Set(), "leaf").map((r) => r.tag.id),
    ["root", "middle", "leaf"],
  )
  assert.deepEqual([...descendants(records, "middle")], ["middle", "leaf"])
  const deep = Array.from({ length: 3000 }, (_, i) => tag(String(i), i ? String(i - 1) : null))
  assert.equal(forestView(deep, new Set(), "2999").length, 3000)
})
test("management navigation survives suspension and absent reads; confirmed deletion clears selection", async () => {
  const { tags, browser } = setup()
  browser.select("root")
  browser.toggle("root")
  browser.find("child")
  browser.scrollTop = 240
  browser.suspend()
  assert.equal(browser.tagId, "root")
  assert(browser.expanded.has("root"))
  assert.equal(browser.lookup, "child")
  assert.equal(browser.scrollTop, 240)
  tags.vocabulary = []
  await tags.read()
  assert.equal(browser.tagId, "root")
  await tags.write({ operation: "delete", id: "root", revision: "one" }, "delete")
  assert.equal(browser.tagId, undefined)
  assert(browser.expanded.has("root"))
  browser.dispose()
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
