import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { entityFixture, complete } from "./support/entity-fixture.js";
import { createMediaToolPathsDefaults, MediaToolPathsGroupId, type LocusClient, type components } from "./src/index.js";
const fixture = await entityFixture("smoke");
const route = "/api/v1/settings/groups/{group_id}";
const params = { path: { group_id: MediaToolPathsGroupId } };
async function read(client:LocusClient) {
  const result = await client.GET(route,{params}); assert(result.data?.status === "current",JSON.stringify(result)); return result.data.saved;
}
async function active(client:LocusClient) {
  const result = await client.GET("/api/v1/settings/media-runtime");assert(result.data?.status === "active",JSON.stringify(result.error));return result.data.runtime;
}
async function change(client:LocusClient,change:components["schemas"]["SettingsChange"],request_id=randomUUID()) {
  const result=await client.POST(route,{params,body:{request_id,change}});assert(result.data,JSON.stringify(result.error));return result.data;
}
try {
  const first=await fixture.start({});
  const definitions=await first.client.GET("/api/v1/settings/definitions");assert(definitions.data);
  assert.deepEqual(definitions.data[0].defaults,createMediaToolPathsDefaults());
  const initial=await read(first.client);assert.deepEqual(initial.value,createMediaToolPathsDefaults());
  const before=await active(first.client);assert.equal(before.ffprobe.environment,null);
  const value={ffprobe:join(fixture.root,"saved-absent-probe"),ffmpeg:join(fixture.root,"saved-absent-encoder")};
  const id=randomUUID();const input={operation:"update",expected_revision:initial.metadata.revision,value} as const;
  const duplicates=await Promise.all([change(first.client,input,id),change(first.client,input,id)]);
  const saved=duplicates[0];assert(saved.status==="settings_saved");assert.deepEqual(duplicates[1],saved);
  assert.deepEqual(await active(first.client),before);
  assert.equal((await change(first.client,{operation:"reset",expected_revision:initial.metadata.revision})).status,"settings_conflict");
  assert.deepEqual((await first.client.GET("/api/v1/requests/{request_id}",{params:{path:{request_id:id}}})).data,{status:"direct_complete",outcome:saved});
  await first.stop();

  const second=await fixture.start({});const captured=await active(second.client);
  assert.deepEqual(captured.captured,saved.saved);assert.equal(captured.ffprobe.path,value.ffprobe);assert.equal(captured.ffprobe.environment,null);
  assert.equal((await second.client.GET("/api/v1/requests/{request_id}",{params:{path:{request_id:id}}})).error?.code,"unknown_request");
  // A recognized synthetic MP4 header reaches actual Video execution. The saved
  // nonexistent executable path must cause a tool-unavailable result, independent
  // of the host's provisioned ffprobe. No process environment is modified.
  const source=join(fixture.root,"synthetic.mp4");await writeFile(source,Buffer.from([0,0,0,20,...Buffer.from("ftypisom"),0,0,0,0,...Buffer.from("mp42")]));
  const imported=await second.client.POST("/api/v1/imports",{body:{request_id:randomUUID(),source_path:source}});assert(imported.data);const file=await complete(second.client,imported.data.task_id);assert(file.status==="imported");
  const entity=await second.client.POST("/api/v1/entities",{body:{request_id:randomUUID()}});assert(entity.data?.status==="entity_created");
  const video=await second.client.POST("/api/v1/media",{body:{request_id:randomUUID(),kind:"video"}});assert(video.data?.status==="media_created");
  for (const [kind_id,component_id] of [[file.file.kind_id,file.file.file_id],[video.data.kind_id,video.data.target.component_id]]) {
    assert.equal((await second.client.POST("/api/v1/memberships/attach",{body:{request_id:randomUUID(),membership:{entity_id:entity.data.entity_id,kind_id,component_id}}})).data?.status,"attached");
  }
  const attempt=await second.client.POST("/api/v1/interpretations",{body:{request_id:randomUUID(),target:video.data.target}});assert(attempt.data);
  const outcome=await complete(second.client,attempt.data.task_id);assert(outcome.status==="interpreted" && outcome.result.status==="accepted",JSON.stringify(outcome));
  assert.equal(outcome.result.record.last_failure?.code,"tool_unavailable");
  await second.stop();

  const overrides={ffprobe:join(fixture.root,"override-probe"),ffmpeg:join(fixture.root,"override-encoder")};
  const third=await fixture.start(overrides);const runtime=await active(third.client);
  assert.deepEqual(await read(third.client),saved.saved);assert.deepEqual(runtime.captured,saved.saved);
  assert.deepEqual(runtime.ffprobe,{path:overrides.ffprobe,environment:"LOCUS_FFPROBE"});
  assert.deepEqual(runtime.ffmpeg,{path:overrides.ffmpeg,environment:"LOCUS_FFMPEG"});
  assert.deepEqual((await third.client.GET("/api/v1/settings/definitions")).data?.[0].defaults,createMediaToolPathsDefaults());
  const reset=await change(third.client,{operation:"reset",expected_revision:saved.saved.metadata.revision});assert(reset.status==="settings_saved");assert.deepEqual(reset.saved.value,createMediaToolPathsDefaults());
  assert.deepEqual(await active(third.client),runtime);await third.stop();
  console.log("PASS settings: generated defaults, guarded duplicate/recovered saves, retained versus active, same-library restart, actual Video tool execution failure, explicit environment provenance and reset without hot application.");
} finally { await fixture.dispose(); }
