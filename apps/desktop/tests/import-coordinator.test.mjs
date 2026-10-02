import assert from "node:assert/strict"
import { test } from "node:test"
import { ApiFailure } from "../src/renderer/shared/api/backend-api.ts"
import { ImportCoordinator } from "../src/renderer/features/file-import/model/import-coordinator.ts"
const item = (effect = "1") => ({
  item_id: "i",
  active_request_id: null,
  current: { base: { state: "success" }, effect_revision: effect, entity_id: "e", complete: true, kinds: [] },
})
function fixture() {
  const calls = [],
    effects = []
  const api = {
    context: { runId: "run" },
    imports: async () => ({
      run_id: "run",
      admission: "open",
      batches: [
        {
          batch_id: "b",
          original_ended: true,
          items: [{ ...item(), attempts: [{ request_id: "request" }] }],
        },
      ],
    }),
    importBatch: async (body) => {
      calls.push(body)
      return { run_id: "run", request_id: body.request_id }
    },
    recoverImport: async (body) => {
      calls.push(body)
      return { run_id: "run", request_id: body.request_id }
    },
    submission: async (id) => ({ status: "accepted", receipt: { run_id: "run", request_id: id } }),
  }
  const bridge = { selectImportFiles: async () => ({ status: "canceled" }) }
  const coordinator = new ImportCoordinator(
    api,
    bridge,
    (e) => effects.push(e),
    () => "request",
  )
  return { api, bridge, coordinator, calls, effects }
}
test("external equal request IDs cannot satisfy private pending submission attribution", async () => {
  const f = fixture()
  f.bridge.selectImportFiles = async () => ({ status: "selected", paths: ["local"] })
  f.api.importBatch = async () => { throw Error("lost response") }
  f.api.imports = async () => ({ run_id: "run", admission: "open", batches: [] })
  await f.coordinator.select()
  f.coordinator.observeTasks([{ access_context: "external", task_id: "external-task", request_id: "request", operation: { kind: "import_batch", batch_id: "external-batch", item_count: 1 } }])
  assert.equal(f.coordinator.submissions.get("request").accepted, undefined)
  assert.equal(f.coordinator.available, true)
  f.coordinator.observeTasks([{ access_context: "desktop", task_id: "private-task", request_id: "request", operation: { kind: "import_batch", batch_id: "independent-private-batch", item_count: 1 } }])
  assert.equal(f.coordinator.submissions.get("request").accepted, true)
  f.coordinator.dispose()
})
test("cancel and empty selection submit nothing; mixed paths use one stable batch", async () => {
  const f = fixture()
  await f.coordinator.select()
  assert.equal(f.calls.length, 0)
  f.bridge.selectImportFiles = async () => ({ status: "selected", paths: [] })
  await f.coordinator.select()
  assert.equal(f.calls.length, 0)
  f.bridge.selectImportFiles = async () => ({ status: "selected", paths: ["image", "plain"] })
  await f.coordinator.select()
  assert.deepEqual(f.calls[0], { request_id: "request", source_paths: ["image", "plain"] })
  f.coordinator.dispose()
})
test("public task acceptance prevents lost-response replay and verifies retained receipt attribution", async () => {
  const f = fixture()
  f.bridge.selectImportFiles = async () => ({ status: "selected", paths: ["original"] })
  f.api.importBatch = async (body) => {
    f.calls.push(body)
    throw Error("response lost")
  }
  await f.coordinator.select()
  f.coordinator.observeTasks([
    {
      access_context: "desktop", task_id: "task",
      request_id: "request",
      operation: { kind: "import_batch", batch_id: "request", item_count: 1 },
    },
  ])
  f.api.submission = async () => {
    throw new ApiFailure({ code: "unknown_request", message: "Unknown request" }, 404)
  }
  await f.coordinator.checkRequest("request")
  assert.equal(f.calls.length, 1)
  assert.equal(f.coordinator.submissions.get("request").accepted, true)
  f.coordinator.observeTasks([
    {
      access_context: "desktop", task_id: "different-task",
      request_id: "request",
      operation: { kind: "import_batch", batch_id: "request", item_count: 1 },
    },
  ])
  assert.equal(f.coordinator.available, false)
  assert.match(f.coordinator.problem, /attribution/)
  f.coordinator.dispose()
})
test("selection and definite admission failures remain discoverable after successful observation", async () => {
  const f = fixture()
  f.bridge.selectImportFiles = async () => ({ status: "failed", message: "picker unavailable" })
  await f.coordinator.select()
  await f.coordinator.observe()
  assert.equal(f.coordinator.problem, undefined)
  assert.match(f.coordinator.notices[0], /picker unavailable/)
  f.bridge.selectImportFiles = async () => ({ status: "selected", paths: ["source"] })
  f.api.importBatch = async () => {
    throw new ApiFailure({ code: "launch_rejected", message: "launch unavailable" }, 500)
  }
  await f.coordinator.select()
  await f.coordinator.observe()
  assert.match(f.coordinator.notices[1], /launch unavailable/)
  assert.equal(f.coordinator.submissions.size, 0)
  f.coordinator.dispose()
})
test("lost response recovers original identity without new mutation and locks competing recovery", async () => {
  const f = fixture()
  f.api.recoverImport = async (body) => {
    f.calls.push(body)
    throw Error("response lost")
  }
  await f.coordinator.recover("b", "i", "retry")
  assert(f.coordinator.itemPending("i"))
  await f.coordinator.recover("b", "i", "recopy")
  assert.equal(f.calls.length, 1)
  await f.coordinator.checkRequest("request")
  assert.equal(f.calls.length, 1)
  assert(!f.coordinator.itemPending("i"))
  assert.equal(f.coordinator.batches.length, 1)
  f.coordinator.dispose()
})
test("effect revisions coalesce progress; observer failure and host loss preserve last-known records", async () => {
  const f = fixture()
  await f.coordinator.observe()
  await f.coordinator.observe()
  assert.equal(f.effects.length, 1)
  f.api.imports = async () => ({
    run_id: "run",
    admission: "open",
    batches: [{ access_context: "desktop", original_request_id: "b", batch_id: "b", original_ended: true, items: [item("3")] }],
  })
  await f.coordinator.observe()
  assert.equal(f.effects.length, 2)
  f.api.imports = async () => {
    throw Error("offline")
  }
  await f.coordinator.observe()
  assert.equal(f.coordinator.batches.length, 1)
  assert.match(f.coordinator.problem, /last known/)
  f.coordinator.host({ connection: { status: "lost", message: "gone" }, close: { phase: "idle" } })
  assert.equal(f.coordinator.available, false)
  await f.coordinator.recover("b", "i", "retry")
  assert.equal(f.calls.length, 0)
  f.coordinator.dispose()
})

test("accepted receipts survive first snapshot failure with original paths and no replay", async () => {
  const f = fixture()
  f.bridge.selectImportFiles = async () => ({ status: "selected", paths: ["selected-source"] })
  f.api.imports = async () => {
    throw Error("first observation lost")
  }
  await f.coordinator.select()
  assert.equal(f.coordinator.submissions.get("request").accepted, true)
  assert.deepEqual(f.coordinator.submissions.get("request").body.source_paths, ["selected-source"])
  await f.coordinator.checkRequest("request")
  assert.equal(f.coordinator.submissions.get("request").accepted, true)
  assert.equal(f.calls.length, 1)
  f.api.imports = async () => ({
    run_id: "run",
    admission: "open",
    batches: [{ access_context: "desktop", original_request_id: "request", batch_id: "request", original_ended: true, items: [item()] }],
  })
  await f.coordinator.observe()
  assert.equal(f.coordinator.submissions.size, 0)
  assert.equal(f.calls.length, 1)
  assert.equal(f.coordinator.batches[0].items[0].current.complete, true)
  f.coordinator.dispose()
})

const unknown = () => new ApiFailure({ code: "unknown_request", message: "Unknown request in this run" }, 404)
test("explicit unknown-request check redelivers the identical original batch and recovery body", async () => {
  for (const recovering of [false, true]) {
    const f = fixture()
    f.bridge.selectImportFiles = async () => ({ status: "selected", paths: ["original-source"] })
    const deliver = async (body) => {
      f.calls.push(body)
      if (f.calls.length === 1) throw Error("delivery never reached server")
      return { run_id: "run", request_id: body.request_id }
    }
    f.api.importBatch = deliver
    f.api.recoverImport = deliver
    f.api.submission = async () => {
      throw unknown()
    }
    f.api.imports = async () => {
      throw Error("observation temporarily unavailable")
    }
    if (recovering) await f.coordinator.recover("batch", "item", "retry")
    else await f.coordinator.select()
    const retained = f.coordinator.submissions.get("request")
    assert.equal(f.calls.length, 1)
    await f.coordinator.checkRequest("request")
    assert.equal(f.calls.length, 2)
    assert.equal(f.calls[0], f.calls[1], "same complete body object, request identity and operation")
    assert.equal(f.coordinator.submissions.get("request"), retained)
    assert.equal(retained.accepted, true)
    await f.coordinator.checkRequest("request")
    assert.equal(f.calls.length, 2, "an accepted request is never redelivered even if lookup becomes unknown")
    assert.match(retained.problem, /previously accepted/)
    f.coordinator.dispose()
  }
})
test("unknown request cannot redeliver after gate closure or wrong-run evidence", async () => {
  for (const mode of ["host-close", "backend-drain", "wrong-run", "wrong-run-host", "wrong-run-snapshot"]) {
    const f = fixture()
    f.api.recoverImport = async (body) => {
      f.calls.push(body)
      throw Error("delivery lost")
    }
    await f.coordinator.recover("b", "i", "retry")
    if (mode === "host-close")
      f.coordinator.host({ connection: { status: "ready", runId: "run" }, close: { phase: "draining" } })
    if (mode === "backend-drain") {
      f.api.imports = async () => ({ run_id: "run", admission: "draining", batches: [] })
      await f.coordinator.observe()
    }
    if (mode === "wrong-run-snapshot") {
      f.api.imports = async () => ({ run_id: "another-run", admission: "open", batches: [] })
      await f.coordinator.observe()
    }
    if (mode === "wrong-run-host")
      f.coordinator.host({ connection: { status: "ready", runId: "another-run" }, close: { phase: "idle" } })
    f.api.submission = async () => {
      throw mode === "wrong-run"
        ? new ApiFailure({ code: "wrong_run", message: "Wrong run" }, 409)
        : unknown()
    }
    await f.coordinator.checkRequest("request")
    assert.equal(f.calls.length, 1, mode)
    assert(f.coordinator.submissions.has("request"))
    if (mode === "wrong-run") {
      f.coordinator.host({ connection: { status: "ready", runId: "run" }, close: { phase: "idle" } })
      f.api.submission = async () => {
        throw unknown()
      }
      await f.coordinator.checkRequest("request")
      assert.equal(f.calls.length, 1, "wrong-run evidence cannot be reopened by stale host state")
    }
    f.coordinator.dispose()
  }
})
test("gate is checked again when unknown lookup completes after close begins", async () => {
  const f = fixture()
  f.api.recoverImport = async (body) => {
    f.calls.push(body)
    throw Error("delivery lost")
  }
  await f.coordinator.recover("b", "i", "retry")
  let reject
  f.api.submission = () =>
    new Promise((_resolve, no) => {
      reject = no
    })
  const checking = f.coordinator.checkRequest("request")
  f.coordinator.host({ connection: { status: "ready", runId: "run" }, close: { phase: "draining" } })
  reject(unknown())
  await checking
  assert.equal(f.calls.length, 1)
  assert.match(f.coordinator.submissions.get("request").problem, /new work is closed/)
  f.coordinator.dispose()
})

test("fast recovery ending between snapshots replaces incomplete results and reports new effects", async () => {
  const f = fixture()
  const failed = item()
  failed.current.complete = false
  f.api.imports = async () => ({
    run_id: "run",
    admission: "open",
    batches: [{ access_context: "desktop", original_request_id: "b", batch_id: "b", original_ended: true, items: [failed] }],
  })
  await f.coordinator.observe()
  assert.equal(f.coordinator.batches[0].items[0].current.complete, false)
  assert.equal(f.effects.length, 1)
  f.api.imports = async () => ({
    run_id: "run",
    admission: "open",
    batches: [{ access_context: "desktop", original_request_id: "b", batch_id: "b", original_ended: true, items: [item("2")] }],
  })
  await f.coordinator.observe()
  assert.equal(f.coordinator.batches[0].items[0].current.complete, true)
  assert.equal(f.coordinator.batches[0].items[0].current.effect_revision, "2")
  assert.equal(f.effects.length, 2)
  assert.equal(f.effects[1][0].current.effect_revision, "2")
  f.coordinator.dispose()
})
