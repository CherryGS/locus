import assert from "node:assert/strict"
import { test } from "node:test"
import {
  formatDurationMilliseconds,
  unixMillisecondsIso,
} from "../src/renderer/entities/entity/lib/format-metadata.ts"

test("source duration formatting preserves milliseconds and large integer claims", () => {
  assert.equal(formatDurationMilliseconds("635000"), "10:35")
  assert.equal(formatDurationMilliseconds("3604001"), "1:00:04.001")
  assert.equal(formatDurationMilliseconds("4010"), "0:04.01")
  assert.equal(formatDurationMilliseconds(0), "0:00")
  assert.equal(formatDurationMilliseconds("9007199254740993"), "2501999792:59:00.993")
  for (const value of ["", "unknown", "-1", "0.5", Infinity])
    assert.equal(formatDurationMilliseconds(value), undefined)
})

test("Unix milliseconds keep exact supported dates and reject unusable source claims", () => {
  assert.equal(unixMillisecondsIso("1612861422000"), "2021-02-09T09:03:42.000Z")
  assert.equal(unixMillisecondsIso("1"), "1970-01-01T00:00:00.001Z")
  assert.equal(unixMillisecondsIso(-1), "1969-12-31T23:59:59.999Z")
  assert.equal(unixMillisecondsIso("8640000000000000"), "+275760-09-13T00:00:00.000Z")
  for (const value of ["", "unknown", "1.5", "9007199254740993", Infinity])
    assert.equal(unixMillisecondsIso(value), undefined)
})
