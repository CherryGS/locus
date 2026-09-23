import assert from "node:assert/strict"
import { test } from "node:test"
import { TaskObserver } from "../src/renderer/entities/task/model/task-observer.ts"
import { ApiFailure } from "../src/renderer/shared/api/backend-api.ts"
import { readTaskEvents } from "../src/renderer/shared/api/task-events.ts"

const task = (state = "running", operation = { kind: "import_batch", batch_id: "batch", item_count: 2 }) => ({
  access_context: "desktop", task_id: "task",
  request_id: "batch",
  label: "untrusted label",
  operation,
  state,
  stage: null,
  message: null,
  completed: null,
  total: null,
  outcome_available: state === "terminal",
})
const snapshot = (revision, tasks, run_id = "run") => ({ run_id, revision: String(revision), tasks })
const tick = () => new Promise((done) => setTimeout(done, 0))
function fixture() {
  let reads = 0,
    imports = 0
  const api = {
    context: { runId: "run" },
    tasks: async () => snapshot(1, [task()]),
    taskOutcome: async () => {
      reads++
      return { status: "complete", outcome: { status: "import_batch", batch_id: "batch" } }
    },
    taskEvents: async () => {},
  }
  return { api, model: new TaskObserver(api, () => imports++), reads: () => reads, imports: () => imports }
}
test("equal request IDs in different access contexts remain independent and upload outcomes stay attributable", async () => {
  const f = fixture()
  const external = { ...task("running", { kind: "upload", upload_id: "upload", filename: null, byte_count: "0" }), access_context: "external", task_id: "external-task" }
  f.model.accept(snapshot(1, [task(), external]))
  assert.equal(f.model.records.size, 2)
  f.api.taskOutcome = async () => ({ status: "complete", outcome: { status: "upload", result: { upload_id: "upload", byte_count: "0", confirmed_file_id: "confirmed", uncertain: false, actions: [] } } })
  f.model.accept(snapshot(2, [task(), { ...external, state: "terminal", outcome_available: true }]))
  await tick()
  assert.equal(f.model.records.get("external-task").outcome.result.confirmed_file_id, "confirmed")
  assert.throws(() => f.model.accept(snapshot(3, [task(), { ...external, access_context: "desktop" }])), /duplicate|identity/)
  f.model.dispose()
})
test("SSE reads split CRLF, UTF-8 and multiline data before EOF", async () => {
  const value = snapshot(1, [{ ...task(), label: "图像" }])
  const json = JSON.stringify(value).replace(',"revision"', ',\n"revision"')
  const bytes = new TextEncoder().encode(
    `: keepalive\r\nevent: snapshot\r\n${json
      .split("\n")
      .map((line) => `data: ${line}\r\n`)
      .join("")}\r\n`,
  )
  const controller = new AbortController(),
    received = []
  const stream = new ReadableStream({
    start(output) {
      for (const byte of bytes) output.enqueue(Uint8Array.of(byte))
    },
  })
  await readTaskEvents(stream, controller.signal, (event) => {
    received.push(event)
    controller.abort()
  })
  assert.deepEqual(received, [value])
})
test("task snapshots retain attribution, reject regressions and heal unchanged reconnect", async () => {
  const f = fixture()
  f.model.accept(snapshot(1, [task()]))
  f.model.accept(snapshot(2, [{ ...task(), completed: "1" }]))
  assert.equal(f.imports(), 1, "progress ticks do not reread all import details")
  f.model.problem = "offline"
  f.model.accept(snapshot(2, [{ ...task(), completed: "1" }]))
  assert.equal(f.model.problem, undefined)
  f.model.accept(snapshot(1, [task()]))
  assert.equal(f.model.records.get("task").task.completed, "1")
  assert.throws(
    () =>
      f.model.accept(
        snapshot(3, [
          {
            ...task(),
            request_id: "other",
            operation: { kind: "import_batch", batch_id: "other", item_count: 2 },
          },
        ]),
      ),
    /identity/,
  )
  f.model.accept(snapshot(3, [task("terminal")]))
  await tick()
  assert.equal(f.model.records.get("task").outcome.status, "import_batch")
  assert.throws(() => f.model.accept(snapshot(4, [task()])), /regressed/)
  assert.equal(f.reads(), 1)
  f.model.dispose()
})
test("terminal detail failures stay terminal; outcome reads coalesce and recover without mutation", async () => {
  const f = fixture()
  let release
  f.api.taskOutcome = () =>
    new Promise((done) => {
      release = done
    })
  f.model.accept(snapshot(1, [task("terminal")]))
  await f.model.outcome("task")
  release({ status: "complete", outcome: { status: "import_batch", batch_id: "wrong" } })
  await tick()
  assert.equal(f.model.records.get("task").task.state, "terminal")
  assert.match(f.model.records.get("task").problem, /attribution/)
  f.api.taskOutcome = async () => ({
    status: "complete",
    outcome: { status: "failed", diagnostic: { kind: "executor", message: "worker failed" }, progress: null },
  })
  await f.model.outcome("task")
  assert.equal(
    f.model.records.get("task").outcome.status,
    "failed",
    "executor failure applies to every operation",
  )
  f.api.tasks = async () => {
    throw Error("offline")
  }
  await f.model.reread()
  assert.equal(f.model.records.get("task").outcome.status, "failed")
  f.model.dispose()
})
test("wrong-run snapshot and HTTP errors stop observation and late outcomes", async () => {
  for (const transport of [false, true]) {
    const f = fixture()
    f.model.accept(snapshot(1, [task()]))
    if (transport) {
      f.api.tasks = async () => {
        throw new ApiFailure({ code: "wrong_run", message: "wrong run" }, 409)
      }
      await f.model.reread()
    } else assert.throws(() => f.model.accept(snapshot(2, [], "other")), /another backend run/)
    f.model.accept(snapshot(3, [task("terminal")]))
    assert.equal(f.model.records.get("task").task.state, "running")
    assert.equal(f.reads(), 0)
  }
})
test("malformed attribution and duplicate snapshots preserve the prior projection atomically", () => {
  const f = fixture()
  f.model.accept(snapshot(1, [task()]))
  assert.throws(
    () => f.model.accept(snapshot(2, [{ ...task(), operation: { kind: "preview" } }])),
    /malformed/,
  )
  assert.throws(() => f.model.accept(snapshot(2, [task(), task()])), /duplicate/)
  assert.throws(() => f.model.accept(snapshot(2, [])), /omitted/)
  assert.equal(f.model.records.size, 1)
  f.model.dispose()
})
test("Media outcomes keep accepted warnings and reject differently attributed results", async () => {
  const f = fixture(),
    target = { kind: "image", component_id: "component" }
  f.api.taskOutcome = async () => ({
    status: "complete",
    outcome: {
      status: "interpreted",
      result: {
        status: "accepted",
        record: { target: { component_id: "other", kind: "image" }, revision: "1", last_failure: null },
      },
    },
  })
  f.model.accept(snapshot(1, [task("terminal", { kind: "interpretation", target })]))
  await tick()
  assert.match(f.model.records.get("task").problem, /attribution/)
  f.api.taskOutcome = async () => ({
    status: "complete",
    outcome: {
      status: "interpreted",
      result: {
        status: "accepted",
        record: {
          revision: "1",
          target: { component_id: "component", kind: "image" },
          last_failure: { code: "missing_input", detail: "Input unavailable" },
        },
      },
    },
  })
  await f.model.outcome("task")
  assert.equal(f.model.records.get("task").outcome.result.record.last_failure.code, "missing_input")
  f.model.dispose()
})
test("malformed terminal detail remains recoverable without crashing or changing execution", async () => {
  const f = fixture()
  f.api.taskOutcome = async () => ({ status: "complete", outcome: { status: "failed" } })
  f.model.accept(snapshot(1, [task("terminal")]))
  await tick()
  assert.equal(f.model.records.get("task").outcome, undefined)
  assert.equal(f.model.records.get("task").task.state, "terminal")
  assert.match(f.model.records.get("task").problem, /malformed/)
  f.api.taskOutcome = async () => ({
    status: "complete",
    outcome: { status: "import_batch", batch_id: "batch" },
  })
  await f.model.outcome("task")
  assert.equal(f.model.records.get("task").outcome.status, "import_batch")
  assert.equal(f.model.records.get("task").problem, undefined)
  f.model.dispose()
})
