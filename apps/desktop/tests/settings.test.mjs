import assert from "node:assert/strict"
import test from "node:test"
import { SettingsCoordinator } from "../src/renderer/features/settings/model/settings-coordinator.ts"
import { ApiFailure } from "../src/renderer/shared/api/backend-api.ts"
import { CloseGate } from "../src/main/close-gate.ts"
import { relaunchArguments, startupLocator } from "../src/main/relaunch.ts"
import { MediaToolPathsGroupId as group } from "@locus/client"
const saved = (revision = "r1", ffprobe = "probe") => ({
  group_id: group,
  metadata: { revision, version: "1" },
  value: { ffprobe, ffmpeg: "encoder" },
})
const current = (...args) => ({ status: "current", saved: saved(...args) })
const defer = () => {
  let resolve, reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
function fixture(overrides = {}) {
  const calls = []
  const api = {
    settingsRead: async () => current(),
    settingsDefinitions: async () => [{ group_id: group }],
    mediaRuntime: async () => ({
      status: "active",
      runtime: {
        captured: saved(),
        ffprobe: { path: "probe", environment: null },
        ffmpeg: { path: "encoder", environment: null },
      },
    }),
    settingsChange: async (_id, body) => {
      calls.push(body)
      return { status: "settings_saved", saved: saved("r2", body.change.value?.ffprobe ?? "probe") }
    },
    submission: async () => ({ status: "direct_pending" }),
    ...overrides,
  }
  return { settings: new SettingsCoordinator(api, () => "original-id"), calls, api }
}
test("draft survives navigation owner reuse and late observations or save results", async () => {
  const read = defer(),
    write = defer(),
    f = fixture()
  await f.settings.load()
  f.api.settingsRead = () => read.promise
  const reading = f.settings.read()
  f.settings.edit("ffprobe", "draft")
  read.resolve(current())
  await reading
  assert.equal(f.settings.draft.ffprobe, "draft")
  f.api.settingsChange = () => write.promise
  const saving = f.settings.save()
  f.settings.edit("ffprobe", "newer")
  write.resolve({ status: "settings_saved", saved: saved("r2", "draft") })
  await saving
  assert.equal(f.settings.draft.ffprobe, "newer")
  assert.equal(f.settings.observation.saved.value.ffprobe, "draft")
  assert.equal(f.settings.dirty, true)
  assert.equal(f.settings.runtime.runtime.captured.metadata.revision, "r1")
})
test("conflicts and definite failures require deliberate abandonment, never automatic overwrite", async () => {
  const f = fixture({
    settingsChange: async () => ({ status: "settings_conflict", current: current("winner", "other") }),
  })
  await f.settings.load()
  f.settings.edit("ffprobe", "mine")
  await f.settings.save()
  assert.equal(f.settings.draft.ffprobe, "mine")
  assert.equal(f.settings.editable, false)
  assert.equal(f.settings.canSave, false)
  assert.equal(f.settings.discard(), true)
  assert.equal(f.settings.draft.ffprobe, "other")
  assert.equal(f.settings.editable, true)
  f.api.settingsChange = async () => ({
    status: "failed",
    diagnostic: { owner: "settings", error: { code: "invalid", message: "invalid path" } },
  })
  f.settings.edit("ffmpeg", "bad")
  await f.settings.save()
  assert(f.settings.preparation().blocked)
  assert.equal(f.settings.discard(), true)
  assert.equal(f.settings.preparation().blocked, undefined)
})
test("lost delivery retains original request and body through explicit same-run recovery", async () => {
  const f = fixture()
  await f.settings.load()
  f.settings.edit("ffprobe", "mine")
  let original
  f.api.settingsChange = async (_id, body) => {
    original = body
    throw new Error("lost")
  }
  await f.settings.save()
  assert.equal(f.settings.canSave, false)
  f.api.submission = async (id) => {
    assert.equal(id, "original-id")
    throw new ApiFailure({ code: "unknown_request", message: "unknown" }, 404)
  }
  f.api.settingsChange = async (_id, body) => {
    assert.equal(body, original)
    return { status: "settings_saved", saved: saved("r2", "mine") }
  }
  await f.settings.recover()
  assert.equal(f.settings.status, "saved")
  assert.equal(f.settings.attempt, undefined)
})
test("commit uncertainty requires terminal execution then fresh evidence; failed reads preserve draft", async () => {
  const f = fixture({
    settingsChange: async () => ({
      status: "failed",
      diagnostic: {
        owner: "settings",
        error: { code: "store", diagnostic: { kind: "commit_outcome_unknown", message: "uncertain" } },
      },
    }),
  })
  await f.settings.load()
  f.settings.edit("ffprobe", "mine")
  await f.settings.save()
  assert.equal(f.settings.discard(), false)
  f.api.settingsRead = async () => {
    throw new Error("read failed")
  }
  await f.settings.recover()
  assert.equal(f.settings.needsEvidence, true)
  assert.equal(f.settings.draft.ffprobe, "mine")
  f.api.settingsRead = async () => current("r2", "mine")
  await f.settings.recover()
  assert.equal(f.settings.needsEvidence, false)
  assert.equal(f.settings.discard(), true)
  assert.equal(f.settings.preparation().blocked, undefined)
})
test("unusable saved values never become defaults; reset needs independent metadata and provider", async () => {
  const f = fixture({
    settingsRead: async () => ({
      status: "invalid",
      group_id: group,
      metadata: { revision: "guard", version: "1" },
      message: "invalid",
    }),
  })
  await f.settings.load()
  assert.equal(f.settings.draft, undefined)
  assert.equal(f.settings.resetRevision, "guard")
  f.api.settingsRead = async () => ({
    status: "corrupt",
    group_id: group,
    revision: null,
    version: "1",
    message: "bad revision",
  })
  await f.settings.read()
  assert.equal(f.settings.resetRevision, undefined)
  f.api.settingsRead = async () => ({
    status: "unavailable",
    group_id: group,
    metadata: { revision: "guard", version: "1" },
  })
  await f.settings.read()
  assert.equal(f.settings.resetRevision, undefined)
})
test("restart preparation waits pending save, blocks failures and binds discard to current edit generation", async () => {
  const write = defer(),
    f = fixture({ settingsChange: () => write.promise })
  await f.settings.load()
  f.settings.edit("ffprobe", "mine")
  const saving = f.settings.save()
  let completed = false
  const preparation = f.settings.prepare().then((x) => {
    completed = true
    return x
  })
  await Promise.resolve()
  assert.equal(completed, false)
  write.resolve({ status: "settings_saved", saved: saved("r2", "mine") })
  await saving
  const ready = await preparation
  assert.equal(ready.blocked, undefined)
  assert(f.settings.canSeal(ready.revision, false, true))
  f.settings.edit("ffprobe", "late")
  assert(!f.settings.canSeal(ready.revision, true, true))
  const now = f.settings.preparation()
  assert(!f.settings.canSeal(now.revision, false, true))
  assert(f.settings.seal(now.revision, true, true))
  assert.equal(f.settings.edit("ffprobe", "sealed"), false)
  f.settings.returnToApplication()
  assert(f.settings.edit("ffprobe", "returned"))
})
test("restart gate cannot upgrade close, reuse stale consent, bypass missing readiness or preferences", () => {
  const gate = new CloseGate()
  gate.begin("one", "restart")
  assert.equal(gate.prepared({ attemptId: "one", revision: 0, items: [] }), false)
  gate.prepared({ attemptId: "one", revision: 0, items: [], settings: { revision: 1, draft: true } })
  assert.equal(gate.action({ attemptId: "one", action: "continue", revision: 0, settingsRevision: 0 }), false)
  assert(gate.action({ attemptId: "one", action: "return" }))
  assert.equal(gate.commit({ attemptId: "one", revision: 0, settingsRevision: 1 }), false)
  gate.begin("two", "restart")
  gate.prepared({
    attemptId: "two",
    revision: 1,
    items: [{ entityId: "e", viewId: "v", reason: "failed" }],
    settings: { revision: 1, draft: true },
  })
  assert.equal(gate.action({ attemptId: "two", action: "continue", revision: 1, settingsRevision: 1 }), false)
  gate.action({ attemptId: "two", action: "return" })
  gate.begin("three", "close")
  gate.prepared({ attemptId: "three", revision: 0, items: [], settings: { revision: 0, draft: false } })
  assert(gate.commit({ attemptId: "three", revision: 0, settingsRevision: 0 }))
  assert.equal(gate.begin("four", "restart"), false)
  assert.equal(gate.state.intent, "close")
})
test("relaunch arguments retain only resolved native locator in development and packaged launch", () => {
  const root = process.cwd()
  const args = relaunchArguments(false, ["electron", "--inspect=0", "entry.cjs", "--old-state"], root)
  assert.deepEqual(args, ["entry.cjs", `--locus-library-root=${root}`, "--locus-require-existing"])
  assert.deepEqual(startupLocator(args), { libraryRoot: root, requireExisting: true })
  assert.deepEqual(relaunchArguments(true, ["Locus.exe", "--old-state"], root), args.slice(1))
  assert.throws(() => startupLocator(["--locus-require-existing"]))
  assert.throws(() => startupLocator(["--locus-library-root=relative", "--locus-require-existing"]))
})

test("late runtime and provider observations cannot revive a lost backend; corrupt version keeps independent revision guard", async () => {
  const runtime = defer(),
    definitions = defer(),
    f = fixture({ mediaRuntime: () => runtime.promise, settingsDefinitions: () => definitions.promise })
  const loading = f.settings.load()
  f.settings.lost("ended")
  runtime.resolve({ status: "active", runtime: { captured: saved() } })
  definitions.resolve([{ group_id: group }])
  await loading
  assert.equal(f.settings.runtime, undefined)
  assert.equal(f.settings.definition, undefined)
  assert.equal(f.settings.runtimeError, "ended")
  const repair = fixture({
    settingsRead: async () => ({
      status: "corrupt",
      group_id: group,
      revision: "valid-independent-revision",
      version: null,
      message: "invalid version",
    }),
  })
  await repair.settings.load()
  assert.equal(repair.settings.resetRevision, "valid-independent-revision")
})

test("definition failure survives a later successful group read and clears only on its own retry", async () => {
  const read = defer(),
    f = fixture({
      settingsRead: () => read.promise,
      settingsDefinitions: async () => {
        throw new Error("definition unavailable")
      },
    })
  const loading = f.settings.load()
  await Promise.resolve()
  await Promise.resolve()
  read.resolve(current())
  await loading
  assert.equal(f.settings.readError, undefined)
  assert.equal(f.settings.definitionError, "definition unavailable")
  assert.equal(f.settings.resetRevision, undefined)
  f.api.settingsRead = async () => current()
  f.api.settingsDefinitions = async () => [{ group_id: group }]
  await f.settings.load()
  assert.equal(f.settings.definitionError, undefined)
  assert.equal(f.settings.resetRevision, "r1")
  f.api.mediaRuntime = async () => {
    throw new Error("runtime read failed")
  }
  await f.settings.load()
  assert.equal(f.settings.runtime.status, "active")
  assert.equal(f.settings.runtimeError, "runtime read failed")
})

test("explicit reload cannot silently rebase a dirty edit onto another writer's saved revision", async () => {
  const f = fixture()
  await f.settings.load()
  f.settings.edit("ffprobe", "local")
  f.api.settingsRead = async () => current("other-revision", "remote")
  await f.settings.read()
  assert.equal(f.settings.draft.ffprobe, "local")
  assert.equal(f.settings.canSave, false)
  assert.equal(f.settings.conflict, true)
  assert.equal(f.settings.discard(), true)
  assert.equal(f.settings.draft.ffprobe, "remote")
})

test("a late unknown-request lookup cannot redeliver after backend loss", async () => {
  const lookup = defer(),
    f = fixture({
      settingsChange: async () => {
        throw new Error("lost response")
      },
    })
  await f.settings.load()
  f.settings.edit("ffprobe", "draft")
  await f.settings.save()
  let redeliveries = 0
  f.api.submission = () => lookup.promise
  f.api.settingsChange = async () => {
    redeliveries++
    return { status: "settings_saved", saved: saved() }
  }
  const recovering = f.settings.recover()
  await Promise.resolve()
  f.settings.lost("backend ended")
  lookup.reject(new ApiFailure({ code: "unknown_request", message: "unknown" }, 404))
  await recovering
  assert.equal(redeliveries, 0)
  assert.equal(f.settings.preparation().blocked, "Backend unavailable")
})
