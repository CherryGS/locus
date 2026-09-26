import assert from "node:assert/strict"
import { test } from "node:test"
import { collectNotifications } from "../src/renderer/app/shell/notification-history.ts"

const empty = () => ({ records: [], observed: new Map() })
const notice = { id: "link", title: "Couldn't open link", type: "error", updateKey: 0 }

test("notification content survives toast dismissal without retaining source callbacks", () => {
  let history = collectNotifications(empty(), [{ ...notice, actionProps: { onClick: () => {} } }], false, 100)
  assert.equal(history.records[0].unread, true)
  assert.equal(history.records[0].receivedAt, 100)
  assert.equal("actionProps" in history.records[0], false)
  history = collectNotifications(history, [], false)
  assert.equal(history.records.length, 1)
})

test("cleared notifications are not resurrected by measurement or dismissal", () => {
  let history = collectNotifications(empty(), [notice], false)
  history = { ...history, records: [] }
  history = collectNotifications(history, [{ ...notice, height: 100 }], false)
  assert.equal(history.records.length, 0)
  history = collectNotifications(history, [{ ...notice, transitionStatus: "ending" }], false)
  assert.equal(history.records.length, 0)
})

test("an updated toast replaces its prior notice and arrivals in the open inbox are read", () => {
  let history = collectNotifications(empty(), [notice], false, 100)
  history = collectNotifications(
    history,
    [{ ...notice, title: "Opened", type: "success", updateKey: 1 }],
    true,
    200,
  )
  assert.equal(history.records.length, 1)
  assert.equal(history.records[0].title, "Opened")
  assert.equal(history.records[0].unread, false)
  assert.equal(history.records[0].receivedAt, 200)
})
