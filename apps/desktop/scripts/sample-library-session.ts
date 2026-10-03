import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { basename } from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { createLocusClient, uploadFile, type components } from "@locus/client"
import { startServer } from "./fixture.ts"
export type Wire<N extends keyof components["schemas"]> = components["schemas"][N]
export type SampleCase = {
  name: string
  entityId: string
  fileId?: string
  view: string
  expected: string
  provenance: "synthetic" | "retained"
  input?: string
  result: Wire<"ImportResult">
  currentFileId?: string
  // Explicit provider enrichment is separate from the retained import result.
  civitaiComponentId?: string
}
export type Manifest = {
  format: 1
  root: string
  library: string
  providerConfig: string
  createdAt: string
  cases: SampleCase[]
  retainedInputs: boolean
  notes: string[]
}
export async function sampleSession(library: string, config: string) {
  const server = await startServer(library, undefined, config, true)
  try {
    const runtime = (await server.client.GET("/api/v1/external-access/runtime")).data
    const token = (await server.client.GET("/api/v1/external-access/token")).data
    assert(runtime?.active_address && token?.status === "current")
    const context = {
      origin: "http://" + runtime.active_address,
      runId: server.context.runId,
    }
    const transport: typeof fetch = (input, init) => {
      const request = new Request(input, init)
      assert.equal(new URL(request.url).origin, context.origin)
      request.headers.set("Authorization", "Bearer " + token.token)
      return fetch(new Request(request, { redirect: "error" }))
    }
    const external = createLocusClient(context, transport)
    async function end(request_id: string) {
      const deadline = Date.now() + 180_000
      while (Date.now() < deadline) {
        const response = await external.GET("/external/v1/requests/{request_id}", {
          params: { path: { request_id } },
        })
        assert(response.data, JSON.stringify(response.error))
        assert(response.data.status !== "rejected", JSON.stringify(response.data))
        if (response.data.status === "accepted") {
          const task_id = response.data.receipt.task_id
          const outcome = await external.GET("/external/v1/tasks/{task_id}/outcome", {
            params: { path: { task_id } },
          })
          assert(outcome.data, JSON.stringify(outcome.error))
          if (outcome.data.status === "complete") return outcome.data.outcome
        }
        await delay(20)
      }
      throw new Error("Sample operation timed out: " + request_id)
    }
    async function upload(path: string) {
      const bytes = await readFile(path),
        request_id = randomUUID()
      await uploadFile(
        context,
        {
          request_id,
          filename: basename(path),
          byte_count: String(bytes.length),
        },
        new Uint8Array(bytes),
        transport,
      )
      const outcome = await end(request_id)
      assert(
        outcome.status === "upload" && outcome.result.confirmed_file_id,
        JSON.stringify(outcome),
      )
      return outcome.result.confirmed_file_id
    }
    async function admit(
      path?: string,
      source?: {
        twitter?: Wire<"TwitterSnapshot">
        bilibili?: Wire<"BilibiliSnapshot">
        coverPath?: string
      },
    ) {
      const request_id = randomUUID()
      const response = await external.POST("/external/v1/import-batches", {
        body: {
          request_id,
          items: [
            {
              file_id: path ? await upload(path) : null,
              twitter: source?.twitter,
              bilibili: source?.bilibili,
              cover_file_id: source?.coverPath ? await upload(source.coverPath) : null,
            },
          ],
        },
      })
      assert(response.data, JSON.stringify(response.error))
      await end(request_id)
      const snapshot = await external.GET("/external/v1/import-batches")
      const batch = snapshot.data?.batches.find((b) => b.original_request_id === request_id)
      assert(batch?.original_ended, JSON.stringify(batch))
      const result = batch.items[0].current
      assert(result.confirmed_entity_id, JSON.stringify(result))
      return result
    }
    async function preference(entityId: string, view: string) {
      const saved = await server.client.PUT("/api/v1/entities/{entity_id}/view-preference", {
        params: { path: { entity_id: entityId } },
        body: { request_id: randomUUID(), view_definition_id: view },
      })
      assert.equal(saved.data?.status, "view_preference_saved", JSON.stringify(saved))
    }
    async function replaceFile(entry: SampleCase, path: string) {
      const fileId = await upload(path)
      const membership = {
        entity_id: entry.entityId,
        component_id: entry.fileId!,
        kind_id: "9fd73d3d-d35d-41bc-8b73-402e12f5c017",
      }
      assert.equal(
        (
          await server.client.POST("/api/v1/memberships/detach", {
            body: { request_id: randomUUID(), membership },
          })
        ).data?.status,
        "detached",
      )
      assert.equal(
        (
          await server.client.POST("/api/v1/memberships/attach", {
            body: {
              request_id: randomUUID(),
              membership: { ...membership, component_id: fileId },
            },
          })
        ).data?.status,
        "attached",
      )
      entry.currentFileId = fileId
    }
    return { server, admit, preference, replaceFile }
  } catch (error) {
    await server.stop()
    throw error
  }
}
