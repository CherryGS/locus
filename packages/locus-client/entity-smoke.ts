import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readEntityIds, type components } from "./src/index.js";
import { fixturePng } from "./smoke-png.js";
import { complete, entityFixture } from "./support/entity-fixture.js";

const fixture = await entityFixture("smoke");
try {
  const server = await fixture.start(); const client = server.client;
  const empty = await readEntityIds(client); assert.equal(empty.length, 0);
  const create = async () => {
    const result = await client.POST("/api/v1/entities", { body: { request_id: randomUUID() } });
    assert(result.data?.status === "entity_created"); return result.data.entity_id;
  };
  const mounted = await create(); const vacant = await create();
  const source = join(fixture.root, "synthetic.png"); await writeFile(source, fixturePng(40, 24));
  const imported = await client.POST("/api/v1/imports", { body: { request_id: randomUUID(), source_path: source } }); assert(imported.data);
  const outcome = await complete(client, imported.data.task_id); assert(outcome.status === "imported"); const file = outcome.file;
  const media = await client.POST("/api/v1/media", { body: { request_id: randomUUID(), kind: "image" } }); assert(media.data?.status === "media_created");
  const target = media.data.target;
  const mediaKind = media.data.kind_id;
  // Neither independent component is an Entity until explicitly attached.
  const initial = await readEntityIds(client); assert.equal(initial.length, 2); assert.equal(empty.length, 0);
  assert(initial.indexOf(mounted) >= 0 && initial.indexOf(vacant) >= 0);
  const memberships: components["schemas"]["Membership"][] = [
    { entity_id: mounted, kind_id: file.kind_id, component_id: file.file_id },
    { entity_id: mounted, kind_id: media.data.kind_id, component_id: target.component_id },
  ];
  for (const membership of memberships) assert.equal((await client.POST("/api/v1/memberships/attach", { body: { request_id: randomUUID(), membership } })).data?.status, "attached");
  const tasksBefore = (await client.GET("/api/v1/tasks")).data;
  const filesBefore = await readdir(fixture.library, { recursive: true });
  const missing = "01992853-c123-7000-8000-ffffffffffff";
  const batch = await client.POST("/api/v1/memberships/read", { body: { entity_ids: [mounted, vacant, missing, mounted] } });
  assert(batch.data); assert.equal(batch.data.length, 4);
  assert.equal(batch.data[0].status, "present"); assert.deepEqual(batch.data[0], batch.data[3]);
  assert.deepEqual(batch.data[1], { entity_id: vacant, status: "present", memberships: [] });
  assert.deepEqual(batch.data[2], { entity_id: missing, status: "missing" });
  assert(batch.data[0].status === "present");
  // Dispatch by the observed Kind/Component pair, retaining owner-specific values.
  const fileLink = batch.data[0].memberships.find(m => m.kind_id === file.kind_id)!;
  const mediaLink = batch.data[0].memberships.find(m => m.kind_id === mediaKind)!;
  const fileRead = await client.GET("/api/v1/files/{file_id}", { params: { path: { file_id: fileLink.component_id } } });
  assert.deepEqual(fileRead.data, file);
  const params = { path: { kind: "image", component_id: mediaLink.component_id } } as const;
  const retained = await client.GET("/api/v1/media/{kind}/{component_id}", { params }); assert(retained.data); assert.equal(retained.data.facts, null);
  const contextual = await client.GET("/api/v1/media/{kind}/{component_id}/view", { params }); assert(contextual.data);
  assert.equal(contextual.data.record.facts, null);
  assert.deepEqual((await client.GET("/api/v1/tasks")).data, tasksBefore);
  assert.deepEqual(await readdir(fixture.library, { recursive: true }), filesBefore);

  // Explicit work between discovery and payload read changes the observed facts.
  const interpretation = await client.POST("/api/v1/interpretations", { body: { request_id: randomUUID(), target } }); assert(interpretation.data);
  const interpreted = await complete(client, interpretation.data.task_id); assert(interpreted.status === "interpreted" && interpreted.result.status === "accepted");
  const laterRecord = await client.GET("/api/v1/media/{kind}/{component_id}", { params });
  assert.equal(laterRecord.data?.facts?.width, 40); assert.equal(laterRecord.data?.facts?.height, 24);
  assert.equal(retained.data.facts, null);
  assert.equal((await client.POST("/api/v1/memberships/detach", { body: { request_id: randomUUID(), membership: fileLink } })).data?.status, "detached");
  const changedContext = await client.GET("/api/v1/media/{kind}/{component_id}/view", { params }); assert(changedContext.data);
  assert.deepEqual(changedContext.data.record, laterRecord.data);
  assert.equal(changedContext.data.applicability.status, "incomplete");
  if (changedContext.data.applicability.status === "incomplete") assert.equal(changedContext.data.applicability.current.status, "missing_slot");
  // Earlier facts and membership evidence remain usable, without claiming a snapshot.
  assert.deepEqual((await client.GET("/api/v1/files/{file_id}", { params: { path: { file_id: fileLink.component_id } } })).data, fileRead.data);
  assert.equal(batch.data[0].memberships.length, 2);
  const laterBatch = await client.POST("/api/v1/memberships/read", { body: { entity_ids: [mounted] } });
  assert(laterBatch.data?.[0].status === "present"); assert.equal(laterBatch.data[0].memberships.length, 1);
  const added = await create(); const refresh = await readEntityIds(client);
  assert.equal(refresh.length, 3); assert(refresh.indexOf(added) >= 0); assert.equal(initial.length, 2); assert.equal(initial.indexOf(added), -1);
  await server.stop();
  console.log("PASS real Entity client: empty/complete/refresh, fixed binary sequences, attributed empty/missing/duplicate memberships, observed-kind File/Media dispatch, no implicit interpretation/preview, and changing payload/context with prior facts preserved.");
} finally { await fixture.dispose(); }
