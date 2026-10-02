import assert from "node:assert/strict"
import test from "node:test"
import { ExternalAddressGroupId, MediaToolPathsGroupId } from "@locus/client"
import { ApiFailure } from "../src/renderer/shared/api/backend-api.ts"
import {
  ExternalTokenCoordinator,
  externalAddressSettings,
} from "../src/renderer/features/settings/model/external-access.ts"
import { SettingsCoordinator } from "../src/renderer/features/settings/model/settings-coordinator.ts"
import { DraftPreparationCoordinator } from "../src/renderer/app/providers/draft-preparation.ts"

function deferred() {
  let resolve, reject
  const promise = new Promise((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
function tokenFixture(overrides = {}) {
  let sequence = 0
  const calls = []
  const retained = {
    status: "current",
    run_id: "run-one",
    context_id: "library-access",
    revision: "revision-one",
    token: "synthetic-test-credential",
  }
  const api = {
    context: { runId: "run-one" },
    externalToken: async () => ({ ...retained }),
    resetExternalToken: async (body) => {
      calls.push(body)
      retained.revision = "revision-two"
      retained.token = "synthetic-replaced-credential"
      return { status: "token_reset", revision: retained.revision }
    },
    submission: async () => ({ status: "direct_pending" }),
    ...overrides,
  }
  return { api, retained, calls, token: new ExternalTokenCoordinator(api, () => `reset-${++sequence}`) }
}

test("failed credential reads retain qualified evidence but cannot enable copy or reset", async () => {
  const f = tokenFixture()
  await f.token.read()
  assert(f.token.current)
  f.api.externalToken = async () => {
    throw new Error("observation failed")
  }
  await f.token.read()
  assert(f.token.observation)
  assert.equal(f.token.current, undefined)
  await f.token.reset()
  assert.equal(f.calls.length, 0)
  f.api.externalToken = async () => ({ ...f.retained })
  await f.token.recover()
  assert(f.token.current)
})

test("one unresolved reset survives navigation and recovers its outcome without another rotation", async () => {
  const response = deferred()
  const f = tokenFixture({
    resetExternalToken: (body) => {
      f.calls.push(body)
      return response.promise
    },
  })
  await f.token.read()
  const saving = f.token.reset()
  const original = f.token.attempt
  await f.token.reset()
  await f.token.recover()
  assert.equal(f.calls.length, 1)
  response.reject(new Error("lost response"))
  await saving
  assert.equal(f.token.attempt, original)
  await f.token.read()
  await f.token.recover()
  assert.equal(f.token.attempt, original)
  assert.equal(f.calls.length, 1)
  // Recovery can describe an older completed reset. Only the following fresh
  // observation supplies the current credential, irrespective of UUID ordering.
  f.api.submission = async () => ({
    status: "direct_complete",
    outcome: { status: "token_reset", revision: "zz-old-result" },
  })
  f.retained.revision = "aa-current-observation"
  f.retained.token = "synthetic-newest-credential"
  await f.token.recover()
  assert.equal(f.token.current.revision, "aa-current-observation")
  assert.equal(f.token.current.token, f.retained.token)
  assert.equal(f.token.attempt, undefined)
  assert.equal(f.calls.length, 1)
})

test("unknown original delivery can redeliver only the same reset and revision in the same run", async () => {
  const f = tokenFixture({
    resetExternalToken: async (body) => {
      f.calls.push(body)
      throw new Error("not delivered")
    },
  })
  await f.token.read()
  await f.token.reset()
  const original = f.token.attempt
  f.api.submission = async () => {
    throw new ApiFailure({ code: "unknown_request", message: "unknown" }, 404)
  }
  f.api.resetExternalToken = async (body) => {
    f.calls.push(body)
    assert.equal(body, original)
    return { status: "token_reset", revision: "replacement" }
  }
  await f.token.recover()
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[0], f.calls[1])
  assert.equal(f.token.attempt, undefined)
})

test("late unknown lookup after backend loss cannot resend or overwrite loss feedback", async () => {
  const lookup = deferred()
  const f = tokenFixture({
    resetExternalToken: async (body) => {
      f.calls.push(body)
      throw new Error("lost")
    },
  })
  await f.token.read()
  await f.token.reset()
  f.api.submission = () => lookup.promise
  const recovering = f.token.recover()
  f.token.lost("backend ended")
  lookup.reject(new ApiFailure({ code: "unknown_request", message: "unknown" }, 404))
  await recovering
  assert.equal(f.calls.length, 1)
  assert.equal(f.token.current, undefined)
  assert.equal(f.token.problem, "backend ended")
  assert.equal(f.token.pending, false)
})

test("late reset completion cannot reobserve a lost run", async () => {
  const response = deferred()
  let reads = 0
  const f = tokenFixture({
    externalToken: async () => {
      reads++
      return { ...f.retained }
    },
    resetExternalToken: () => response.promise,
  })
  await f.token.read()
  const resetting = f.token.reset()
  f.token.lost("backend ended")
  response.resolve({ status: "token_reset", revision: "completed-old-run" })
  await resetting
  assert.equal(reads, 1)
  assert.equal(f.token.feedback, undefined)
  assert.equal(f.token.problem, "backend ended")
})

test("wrong-run observation and changed transport context never become current credential state", async () => {
  const f = tokenFixture()
  f.api.externalToken = async () => ({ ...f.retained, run_id: "other-run" })
  await f.token.read()
  assert.equal(f.token.observation, undefined)
  await f.token.reset()
  assert.equal(f.calls.length, 0)
  const second = tokenFixture({
    resetExternalToken: async () => {
      throw new Error("lost")
    },
  })
  await second.token.read()
  await second.token.reset()
  second.api.context.runId = "replacement-run"
  let lookups = 0
  second.api.submission = async () => {
    lookups++
    return { status: "direct_pending" }
  }
  await second.token.recover()
  assert.equal(lookups, 0)
  assert.equal(second.token.current, undefined)
})

test("definite reset rejection differs from failed original-result observation", async () => {
  const f = tokenFixture({
    resetExternalToken: async () => {
      throw new ApiFailure({ code: "admission_closed", message: "closing" }, 503)
    },
  })
  await f.token.read()
  await f.token.reset()
  assert.equal(f.token.attempt, undefined)
  assert(f.token.current)
  assert.match(f.token.feedback, /rejected/)
  f.api.resetExternalToken = async () => {
    throw new Error("lost response")
  }
  await f.token.reset()
  const original = f.token.attempt
  f.api.submission = async () => {
    throw new ApiFailure({ code: "unauthorized", message: "observation denied" }, 401)
  }
  await f.token.recover()
  assert.equal(f.token.attempt, original)
  assert.equal(f.token.current, undefined)
})

test("ended uncertain or executor-failed reset needs fresh current evidence before another reset", async () => {
  for (const result of [
    { status: "token_reset_failed", uncertain: true, message: "commit unconfirmed" },
    { status: "failed", diagnostic: { owner: "executor", message: "worker ended" } },
  ]) {
    const f = tokenFixture({
      resetExternalToken: async (body) => {
        f.calls.push(body)
        return result
      },
    })
    await f.token.read()
    f.api.externalToken = async () => {
      throw new Error("current state unavailable")
    }
    await f.token.reset()
    assert.equal(f.token.attempt, undefined)
    assert.equal(f.token.current, undefined)
    await f.token.reset()
    assert.equal(f.calls.length, 1)
    f.api.externalToken = async () => ({ ...f.retained })
    await f.token.recover()
    assert(f.token.current)
    assert.equal(f.calls.length, 1)
  }
})

function groupsFixture() {
  const values = new Map([
    [
      MediaToolPathsGroupId,
      {
        group_id: MediaToolPathsGroupId,
        metadata: { revision: "m1", version: "1" },
        value: { ffprobe: "ffprobe", ffmpeg: "ffmpeg" },
      },
    ],
    [
      ExternalAddressGroupId,
      {
        group_id: ExternalAddressGroupId,
        metadata: { revision: "e1", version: "1" },
        value: { address: "127.0.0.1:46321" },
      },
    ],
  ])
  const calls = []
  const api = {
    settingsDefinitions: async () => [...values.keys()].map((group_id) => ({ group_id })),
    settingsRead: async (id) => ({ status: "current", saved: structuredClone(values.get(id)) }),
    settingsChange: async (id, body) => {
      calls.push({ id, body })
      const old = values.get(id)
      const value = body.change.operation === "reset" ? { address: "127.0.0.1:46321" } : body.change.value
      const saved = {
        ...old,
        metadata: { ...old.metadata, revision: `${old.metadata.revision}-next` },
        value,
      }
      values.set(id, saved)
      return { status: "settings_saved", saved: structuredClone(saved) }
    },
    mediaRuntime: async () => ({
      status: "active",
      runtime: { captured: structuredClone(values.get(MediaToolPathsGroupId)) },
    }),
    externalRuntime: async () => ({
      captured: structuredClone(values.get(ExternalAddressGroupId)),
      active_address: "127.0.0.1:46321",
      problem: null,
      override_address: null,
    }),
    submission: async () => ({ status: "direct_pending" }),
  }
  const media = new SettingsCoordinator(api, () => "media-save")
  const external = externalAddressSettings(api)
  return { api, calls, media, external, preparation: new DraftPreparationCoordinator([media, external]) }
}

test("both actual Settings groups participate in draft consent, sealing and returning", async () => {
  const f = groupsFixture()
  await Promise.all([f.media.load(), f.external.load()])
  f.media.edit("ffprobe", "new-probe")
  f.external.edit("address", "127.0.0.1:45678")
  const first = await f.preparation.prepare()
  assert.equal(first.draft, true)
  assert.equal(first.blocked, undefined)
  assert.equal(f.preparation.canSeal(first.revision, false, true), false)
  f.external.edit("address", "127.0.0.1:45679")
  assert.equal(f.preparation.canSeal(first.revision, true, true), false)
  const current = await f.preparation.prepare()
  assert(f.preparation.seal(current.revision, true, true))
  assert.equal(f.media.editable, false)
  assert.equal(f.external.editable, false)
  f.preparation.returnToApplication()
  assert.equal(f.media.draft.ffprobe, "new-probe")
  assert.equal(f.external.draft.address, "127.0.0.1:45679")
  assert(f.media.editable && f.external.editable)
})

test("aggregate restart preparation waits both saves and cannot hide one group's failure", async () => {
  const f = groupsFixture(),
    mediaWrite = deferred(),
    externalWrite = deferred()
  await Promise.all([f.media.load(), f.external.load()])
  f.media.edit("ffprobe", "new-probe")
  f.external.edit("address", "bad-address")
  f.api.settingsChange = (id) => (id === MediaToolPathsGroupId ? mediaWrite.promise : externalWrite.promise)
  const saving = Promise.all([f.media.save(), f.external.save()])
  let finished = false
  const preparing = f.preparation.prepare().then((value) => {
    finished = true
    return value
  })
  mediaWrite.resolve({
    status: "settings_saved",
    saved: {
      group_id: MediaToolPathsGroupId,
      metadata: { revision: "m2", version: "1" },
      value: { ffprobe: "new-probe", ffmpeg: "ffmpeg" },
    },
  })
  await Promise.resolve()
  assert.equal(finished, false)
  externalWrite.resolve({
    status: "failed",
    diagnostic: { owner: "settings", error: { code: "invalid", message: "invalid address" } },
  })
  await saving
  const state = await preparing
  assert(state.blocked)
  assert.equal(f.preparation.canSeal(state.revision, true, true), false)
  f.external.discard()
  assert.equal((await f.preparation.prepare()).blocked, undefined)
})

test("address reset changes only its guarded group and leaves Media draft and captured runtime intact", async () => {
  const f = groupsFixture()
  await Promise.all([f.media.load(), f.external.load()])
  f.media.edit("ffprobe", "unsubmitted-probe")
  f.external.edit("address", "127.0.0.1:45678")
  await f.external.save()
  assert.equal(f.external.runtime.active_address, "127.0.0.1:46321")
  await f.external.reset()
  assert.equal(f.external.draft.address, "127.0.0.1:46321")
  assert.equal(f.media.draft.ffprobe, "unsubmitted-probe")
  assert.equal(f.media.dirty, true)
  assert(f.calls.every((call) => call.id === ExternalAddressGroupId))
  assert.equal(f.calls[1].body.change.expected_revision, "e1-next")
})
