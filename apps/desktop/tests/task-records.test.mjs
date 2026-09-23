import assert from "node:assert/strict"
import { test } from "node:test"
import { taskRecords } from "../src/renderer/app/shell/task-records.ts"
import { outcomeSummary } from "../src/renderer/features/task-feedback/ui/task-panel.tsx"
const attempt = (id, kind = "import_batch", state = "terminal", batch_id = "batch") => ({
  task: { access_context: "desktop", task_id: id, request_id: id, state, operation: { kind, batch_id, item_count: 1, item_id: "item" } },
  outcome: { status: "failed", diagnostic: { message: "old executor failure" } },
})
const coordinator = () => ({ batches: [], submissions: new Map() })
test("File failure summary preserves commit uncertainty and actual copy progress", () => {
  const record = {
    task: { state: "terminal" },
    outcome: {
      status: "failed",
      diagnostic: { kind: "commit_outcome_unknown", message: "Commit confirmation unavailable" },
      progress: { bytes_written: "0", copy_complete: false, managed_bytes_may_exist: false },
    },
  }
  const unconfirmed = outcomeSummary(record)
  assert.match(unconfirmed, /Commit outcome unconfirmed/)
  assert.match(unconfirmed, /0 copied bytes.*copy incomplete/)
  assert.doesNotMatch(unconfirmed, /retained|may remain/)
  record.outcome.progress = { bytes_written: "42", copy_complete: true, managed_bytes_may_exist: true }
  assert.match(outcomeSummary(record), /42 copied bytes.*copy complete.*managed bytes may remain/)
})
test("accepted receipt with terminal task never revives activity when detail is unavailable", () => {
  const c = coordinator()
  c.submissions.set("batch", {
    body: { request_id: "batch", source_paths: ["same-path"] },
    pending: false,
    accepted: true,
  })
  const result = taskRecords(c, { records: new Map([["batch", attempt("batch")]]) }, () => null)
  assert.equal(result.length, 1)
  assert.equal(result[0].active, false)
  assert.match(result[0].summary, /Execution ended/)
})
test("current owner results clear historical attention but retain independent original and recovery", () => {
  const c = coordinator()
  c.batches = [
    {
      access_context: "desktop", original_request_id: "batch", batch_id: "batch",
      original_ended: true,
      items: [{ current: { complete: true }, active_request_id: null }],
    },
  ]
  const records = new Map([
    ["batch", attempt("batch")],
    ["retry", attempt("retry", "import_recovery")],
  ])
  const result = taskRecords(c, { records }, () => null)
  assert.equal(result.length, 1)
  assert.equal(result[0].attention, false)
  assert.equal(result[0].attempts.length, 2)
  assert.equal(result[0].attempts[0].outcome.status, "failed")
  c.submissions.set("retry2", {
    body: { request_id: "retry2", access_context: "desktop", original_request_id: "batch", batch_id: "batch", item_id: "item" },
    pending: true,
  })
  assert.equal(taskRecords(c, { records }, () => null)[0].active, true)
})
test("recovery groups only after explicit original attribution; equal source submissions remain separate", () => {
  const c = coordinator()
  c.submissions.set("batch", { body: { request_id: "batch", source_paths: ["same-path"] }, pending: true })
  c.submissions.set("other", { body: { request_id: "other", source_paths: ["same-path"] }, pending: true })
  const records = new Map([["retry", attempt("retry", "import_recovery", "running")]])
  assert.equal(taskRecords(c, { records }, () => null).length, 3)
  c.batches = [{ access_context: "desktop", original_request_id: "batch", batch_id: "batch", original_ended: false, items: [] }]
  const result = taskRecords(c, { records }, () => null)
  assert.equal(result.length, 2)
  assert.equal(result[0].attempts.length, 1)
  assert.equal(result[0].active, true)
})
