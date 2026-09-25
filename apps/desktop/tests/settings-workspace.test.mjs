import assert from "node:assert/strict"
import { test } from "node:test"
import { createMemoryHistory } from "@tanstack/history"
import { SettingsNavigation } from "../src/renderer/app/providers/settings-navigation.ts"
import { restoreGridPosition } from "../src/renderer/pages/entity/model/browsing-state.ts"

test("Settings category, Return and Forward preserve the actual entry visit", () => {
  const history = createMemoryHistory({ initialEntries: ["/entity?mode=grid"] })
  const navigation = new SettingsNavigation()
  let previous = history.location
  history.subscribe(({ location, action }) => {
    navigation.observe(previous, location, action.type)
    previous = location
  })
  const entry = history.location.state.__TSR_key
  history.push("/setting")
  const settingsKey = history.location.state.__TSR_key
  navigation.select("media")
  navigation.select("external")
  assert.equal(history.location.state.__TSR_key, settingsKey)
  assert.equal(navigation.returnDelta(history.location), -1)
  history.go(navigation.returnDelta(history.location))
  assert.equal(history.location.state.__TSR_key, entry)
  history.forward()
  assert.equal(history.location.state.__TSR_key, settingsKey)
  assert.equal(navigation.returnDelta(history.location), -1)
  history.back()
  history.replace("/entity?mode=inspect")
  history.forward()
  assert.equal(
    navigation.returnDelta(history.location),
    undefined,
    "a replaced target is no longer the entry visit",
  )
  history.back()
  history.push("/")
  history.push("/setting")
  assert.equal(navigation.returnDelta(history.location), -1)
  assert.equal(navigation.category, "external")
})

test("fresh Settings does not invent an entry and a new session resets its category", () => {
  const history = createMemoryHistory({ initialEntries: ["/setting"] })
  assert.equal(new SettingsNavigation().returnDelta(history.location), undefined)
  assert.equal(new SettingsNavigation().category, "external")
})

test("grid restoration follows identity through changed order and columns without choosing a replacement", () => {
  const ids = ["a", "b", "c", "d", "e", "f"]
  const sequence = { length: ids.length, at: (index) => ids[index], indexOf: (id) => ids.indexOf(id) }
  const position = { anchor: "e", offset: 17, logical: 417 }
  assert.equal(restoreGridPosition(position, sequence, 2, 100), 217)
  assert.equal(restoreGridPosition(position, sequence, 3, 100), 117)
  ids.unshift("new")
  assert.equal(restoreGridPosition(position, sequence, 2, 100), 217)
  ids.splice(ids.indexOf("e"), 1)
  assert.equal(restoreGridPosition(position, sequence, 2, 100), 417)
  assert.equal(position.anchor, "e")
})
