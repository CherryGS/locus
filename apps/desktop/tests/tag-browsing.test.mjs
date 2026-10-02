import assert from "node:assert/strict"
import { test } from "node:test"
import { TagCoordinator } from "../src/renderer/features/tags/model/tag-coordinator.ts"
import { TagBrowsing } from "../src/renderer/features/tags/model/tag-browsing.ts"
import { suppliedSequence } from "../src/renderer/entities/entity/model/identity-sequence.ts"
import {
  contextSequence,
  resolveReturn,
} from "../src/renderer/pages/entity/model/navigation.ts"
const tick = () => new Promise((resolve) => setImmediate(resolve))
const deferred = () => {
  let resolve
  const promise = new Promise((yes) => {
    resolve = yes
  })
  return { promise, resolve }
}
const record = (id) => ({ id, name: id, revision: "one" })
const observation = (ids, release = async () => {}) => ({
  entities: suppliedSequence(ids),
  release,
})
function setup(search) {
  const tags = new TagCoordinator(
    { tags: async () => [record("a"), record("b")], tagWrite: async () => {} },
    "run",
    () => {},
  )
  const requests = []
  const browser = new TagBrowsing(
    {
      filterLanguage: async () => ({ format: "native", version: 1 }),
      filterLiteral: async (input) => {
        requests.push(input)
        return { condition: `id:${input.value.value}` }
      },
      search,
    },
    tags,
    () => {},
  )
  return { tags, browser, requests }
}
test("superseded Tag results are released and cannot replace the new Tag", async () => {
  const first = deferred(),
    second = deferred()
  let released = 0
  const { browser, requests } = setup(async (source) =>
    source.text === "id:a" ? first.promise : second.promise,
  )
  browser.select("a")
  await tick()
  browser.select("b")
  await tick()
  second.resolve(observation(["b1"]))
  await tick()
  first.resolve(
    observation(["a1"], async () => {
      released++
    }),
  )
  await tick()
  assert.equal(browser.tagId, "b")
  assert.equal(browser.sequence.at(0), "b1")
  assert.equal(released, 1)
  assert.deepEqual(
    requests.map((request) => request.value),
    [
      { type: "identifier", value: "a" },
      { type: "identifier", value: "b" },
    ],
  )
  browser.dispose()
})
test("failed refresh retains fixed identities; assignment effects require explicit refresh", async () => {
  let fail = false
  const { browser, tags } = setup(async () => {
    if (fail) throw new Error("index unavailable")
    return observation(["subject"])
  })
  browser.select("a")
  await tick()
  const sequence = browser.sequence
  tags.attempts.push({
    request: "remove",
    state: "confirmed",
    change: { operation: "remove", entity_id: "subject", tag_id: "a" },
  })
  await tags.read()
  assert.equal(browser.stale, true)
  assert.equal(browser.sequence, sequence)
  fail = true
  await browser.refresh()
  assert.match(browser.error, /index unavailable/)
  assert.equal(browser.sequence, sequence)
  browser.suspend()
  assert.equal(browser.resumeId, "a")
  browser.dispose()
})
test("failed vocabulary is not deletion; confirmed absence does not bind a same-name replacement", async () => {
  const { browser, tags } = setup(async () => observation(["subject"]))
  browser.select("a")
  await tick()
  const sequence = browser.sequence
  tags.api.tags = async () => {
    throw new Error("vocabulary unavailable")
  }
  await tags.read()
  assert.equal(browser.missing, false)
  assert.equal(browser.sequence, sequence)
  tags.api.tags = async () => [{ ...record("replacement"), name: "a" }]
  await tags.read()
  assert.equal(browser.missing, true)
  assert.equal(browser.sequence, undefined)
  assert.equal(browser.resumeId, undefined)
  browser.dispose()
})
test("Tag inspection uses Tag neighbors and returns to the page even when its result is unavailable", () => {
  const main = suppliedSequence(["main"]),
    tagged = suppliedSequence(["tagged1", "tagged2"])
  const context = { id: "tag:a", sequence: tagged }
  const destination = {
    mode: "inspect",
    collectionId: "tag:a",
    entityId: "tagged2",
    source: { mode: "grid", collectionId: "tag:a" },
  }
  assert.equal(
    contextSequence(destination, main, [], suppliedSequence, context),
    tagged,
  )
  assert.deepEqual(
    resolveReturn(destination, main, [], suppliedSequence, true, context)
      .destination,
    { mode: "grid", collectionId: "tag:a", entityId: "tagged2" },
  )
  assert.deepEqual(
    resolveReturn(destination, main, [], suppliedSequence, true, {
      id: "tag:a",
    }).destination,
    { mode: "grid", collectionId: "tag:a", entityId: undefined },
  )
})
