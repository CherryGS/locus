import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readEntityIds, type components, type LocusClient } from "./src/index.js";
import { fixturePng } from "./smoke-png.js";
import { complete, entityFixture } from "./support/entity-fixture.js";

type Observation = components["schemas"]["EntityViewPreference"];
type Saved = components["schemas"]["SavedViewPreference"];
const route = "/api/v1/entities/{entity_id}/view-preference";
const missing = "01992853-c123-7000-8000-ffffffffffff";
const fixture = await entityFixture("smoke");

async function create(client: LocusClient) {
  const result = await client.POST("/api/v1/entities", { body: { request_id: randomUUID() } });
  assert(result.data?.status === "entity_created", JSON.stringify(result.error));
  return result.data.entity_id;
}
async function read(client: LocusClient, entity_id: string): Promise<Observation> {
  const result = await client.GET(route, { params: { path: { entity_id } } });
  assert(result.data, JSON.stringify(result.error));
  return result.data;
}
async function save(client: LocusClient, entity_id: string, view_definition_id: string, expected_revision: string | null, request_id = randomUUID()) {
  const result = await client.PUT(route, {
    params: { path: { entity_id } },
    body: { request_id, view_definition_id, expected_revision },
  });
  assert(result.data, JSON.stringify(result.error));
  return result.data;
}

try {
  const server = await fixture.start(); const client = server.client;
  assert.equal((await readEntityIds(client)).length, 0);
  const entity = await create(client); const independent = await create(client); const unset = await create(client);
  assert.deepEqual(await read(client, entity), { status: "unset", entity_id: entity });
  assert.deepEqual(await read(client, missing), { status: "missing", entity_id: missing });
  // Component values and membership are independent of presentation persistence.
  const source = join(fixture.root, "synthetic.png"); await writeFile(source, fixturePng(16, 12));
  const imported = await client.POST("/api/v1/imports", { body: { request_id: randomUUID(), source_path: source } }); assert(imported.data);
  const importOutcome = await complete(client, imported.data.task_id); assert(importOutcome.status === "imported");
  const file = importOutcome.file;
  const media = await client.POST("/api/v1/media", { body: { request_id: randomUUID(), kind: "image" } }); assert(media.data?.status === "media_created");
  const target = media.data.target;
  const memberships = [
    { entity_id: entity, kind_id: file.kind_id, component_id: file.file_id },
    { entity_id: entity, kind_id: media.data.kind_id, component_id: target.component_id },
  ];
  for (const membership of memberships) assert.equal((await client.POST("/api/v1/memberships/attach", { body: { request_id: randomUUID(), membership } })).data?.status, "attached");
  const mediaParams = { path: { kind: "image", component_id: target.component_id } } as const;
  const recordBefore = (await client.GET("/api/v1/media/{kind}/{component_id}", { params: mediaParams })).data;
  const membershipsBefore = (await client.POST("/api/v1/memberships/read", { body: { entity_ids: [entity] } })).data;
  const identities = await readEntityIds(client);

  const firstId = randomUUID();
  const identical = await Promise.all(Array.from({ length: 6 }, () => save(client, entity, "image.inspect", null, firstId)));
  const first = identical[0]; assert(first.status === "view_preference_saved");
  assert.equal(first.preference.revision, "1");
  for (const response of identical) assert.deepEqual(response, first);
  const independentSaved = await save(client, independent, "future.vendor/unknown-view-v42", null);
  assert(independentSaved.status === "view_preference_saved");
  const second = await save(client, entity, "twitter.read", first.preference.revision);
  assert(second.status === "view_preference_saved"); assert.equal(second.preference.revision, "2");
  const final = await save(client, entity, "image.inspect", second.preference.revision);
  assert(final.status === "view_preference_saved"); assert.equal(final.preference.revision, "3");
  const latest: Saved = final.preference;
  const stale = await save(client, entity, "obsolete", first.preference.revision);
  assert.deepEqual(stale, { status: "view_preference_conflict", current: { status: "saved", ...latest } });
  const absentBasis = await save(client, entity, "obsolete", null);
  assert.equal(absentBasis.status, "view_preference_conflict");
  assert.deepEqual(await save(client, missing, "image.inspect", null), { status: "view_preference_missing", entity_id: missing });

  // Original request recovery reports revision 1 after revision 3 exists, without
  // replaying the old write. A UI coordinator must apply only current intent.
  const recovered = await client.GET("/api/v1/requests/{request_id}", { params: { path: { request_id: firstId } } });
  assert.deepEqual(recovered.data, { status: "direct_complete", outcome: first });
  assert.deepEqual(await save(client, entity, "image.inspect", null, firstId), first);
  const changedBinding = await client.PUT(route, { params: { path: { entity_id: entity } }, body: { request_id: firstId, view_definition_id: "image.inspect", expected_revision: latest.revision } });
  assert.equal(changedBinding.error?.code, "request_conflict");
  assert.deepEqual(await read(client, entity), { status: "saved", ...latest });
  const batch = await client.POST("/api/v1/entities/view-preferences/batch", { body: { entity_ids: [entity, independent, missing, unset, entity] } });
  assert.deepEqual(batch.data, [
    { status: "saved", ...latest }, { status: "saved", ...independentSaved.preference },
    { status: "missing", entity_id: missing }, { status: "unset", entity_id: unset }, { status: "saved", ...latest },
  ]);
  assert.deepEqual((await client.POST("/api/v1/memberships/read", { body: { entity_ids: [entity] } })).data, membershipsBefore);
  assert.deepEqual((await client.GET("/api/v1/media/{kind}/{component_id}", { params: mediaParams })).data, recordBefore);
  assert.deepEqual((await client.GET("/api/v1/files/{file_id}", { params: { path: { file_id: file.file_id } } })).data, file);
  const afterPreferences = await readEntityIds(client);
  assert.deepEqual(
    Array.from({ length: afterPreferences.length }, (_, i) => afterPreferences.at(i)).sort(),
    Array.from({ length: identities.length }, (_, i) => identities.at(i)).sort(),
  );

  assert.equal((await client.POST("/api/v1/memberships/detach", { body: { request_id: randomUUID(), membership: memberships[1] } })).data?.status, "detached");
  const replacement = await client.POST("/api/v1/media", { body: { request_id: randomUUID(), kind: "image" } }); assert(replacement.data?.status === "media_created");
  assert.equal((await client.POST("/api/v1/memberships/attach", { body: { request_id: randomUUID(), membership: { ...memberships[1], component_id: replacement.data.target.component_id } } })).data?.status, "attached");
  assert.deepEqual(await read(client, entity), { status: "saved", ...latest });
  await server.stop();

  const restarted = await fixture.start();
  assert.notEqual(restarted.context.runId, server.context.runId);
  assert.deepEqual(await read(restarted.client, entity), { status: "saved", ...latest });
  assert.deepEqual(await read(restarted.client, independent), { status: "saved", ...independentSaved.preference });
  assert.deepEqual(await read(restarted.client, unset), { status: "unset", entity_id: unset });
  const lostRun = await restarted.client.GET("/api/v1/requests/{request_id}", { params: { path: { request_id: firstId } } });
  assert.equal(lostRun.error?.code, "unknown_request");
  assert.equal((await save(restarted.client, entity, "old-basis", "1")).status, "view_preference_conflict");
  await restarted.stop();
  console.log("PASS real preference client: missing/unset/saved reads, ordered duplicate batches, opaque definitions, conditional A/B/A revisions, concurrent delivery, original request recovery, stale rejection, component independence/replacement, and same-library restart persistence.");
} finally { await fixture.dispose(); }
