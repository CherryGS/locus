import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { entityFixture, complete } from "./support/entity-fixture.js";
import { fixturePng } from "./smoke-png.js";
import { searchEntities, readEntityIds, type LocusClient } from "./src/index.js";

async function ready(client: LocusClient, count?: number) {
  for (let attempt = 0; attempt < 600; attempt++) {
    const status = await client.GET("/api/v1/search/status"); assert(status.data, JSON.stringify(status.error));
    assert.notEqual(status.data.state, "failed", status.data.failure ?? "");
    if (status.data.state === "ready") {
      if (count === undefined) return;
      const result = await searchEntities(client, { format: "locus-native-tantivy-0.26", version: 2, text: "entity_id:*" }); const matches = result.entities.length === count; await result.release(); if (matches) return;
    }
    await delay(20);
  }
  throw new Error("Search did not become ready");
}
const fixture = await entityFixture("smoke");
try {
  let server = await fixture.start(); let client = server.client;
  const catalogue = await client.GET("/api/v1/search/catalogue"); assert(catalogue.data); assert(catalogue.data.fields.some(f => f.id === "civitai_file_name"));
  assert(catalogue.data.fields.every(f => f.native_value && f.native_exact));
  await ready(client, 0); const empty = await searchEntities(client, { format: "locus-native-tantivy-0.26", version: 2, text: "entity_id:*" }); assert.equal(empty.entities.length, 0); await empty.release();
  const create = await client.POST("/api/v1/entities", { body: { request_id: randomUUID() } }); assert(create.data?.status === "entity_created");
  await ready(client, 1);
  const source = join(fixture.root,"search.png");await writeFile(source,fixturePng(40,24));
  const imported=await client.POST("/api/v1/imports",{body:{request_id:randomUUID(),source_path:source}});assert(imported.data);const file=await complete(client,imported.data.task_id);assert(file.status==="imported");
  const media=await client.POST("/api/v1/media",{body:{request_id:randomUUID(),kind:"image"}});assert(media.data?.status==="media_created");
  for(const membership of [{entity_id:create.data.entity_id,kind_id:file.file.kind_id,component_id:file.file.file_id},{entity_id:create.data.entity_id,kind_id:media.data.kind_id,component_id:media.data.target.component_id}])assert.equal((await client.POST("/api/v1/memberships/attach",{body:{request_id:randomUUID(),membership}})).data?.status,"attached");
  const interpretation=await client.POST("/api/v1/interpretations",{body:{request_id:randomUUID(),target:media.data.target}});assert(interpretation.data);await complete(client,interpretation.data.task_id);
  const twitterRequest=randomUUID();const twitter=await client.POST("/api/v1/registered-import-batches",{body:{request_id:twitterRequest,items:[{twitter:{post_id:"123456789",text:"中文 search title",hashtags:[],published_at_unix_ms:"253402300799999"}}]}});assert(twitter.data);
  for(let i=0;i<300;i++){const receipt=await client.GET("/api/v1/requests/{request_id}",{params:{path:{request_id:twitterRequest}}});if(receipt.data?.status==="accepted"){await complete(client,receipt.data.receipt.task_id);break;}await delay(20);assert(i<299,JSON.stringify(receipt));}
  await ready(client,2);
  for(let attempt=0;attempt<300;attempt++){const result=await searchEntities(client,{format:"locus-native-tantivy-0.26",version:2,text:"image_width:40"});const found=result.entities.indexOf(create.data.entity_id)>=0;await result.release();if(found)break;await delay(20);assert(attempt<299);}
  const scoped=await searchEntities(client,{format:"locus-native-tantivy-0.26",version:2,text:'"中文" AND NOT twitter_hashtags:*'});assert.equal(scoped.entities.length,1);
  const attributed=await client.POST("/api/v1/search/evidence",{body:{context:scoped.context!,entities:[scoped.entities.at(0)!]}});assert(attributed.data?.[0].matches.some(m=>m.condition?.includes("中文")));await scoped.release();
  const conjunction=await searchEntities(client,{format:"locus-native-tantivy-0.26",version:2,text:'"中文" AND image_width:40'});assert.equal(conjunction.entities.length,0);await conjunction.release();
  const first = await searchEntities(client, {format:"locus-native-tantivy-0.26",version:2,text:`entity_id:"${create.data.entity_id}"`}); assert.equal(first.entities.at(0), create.data.entity_id);
  const evidence = await client.POST("/api/v1/search/evidence", { body: { context: first.context!, entities: [create.data.entity_id] } }); assert.equal(evidence.data?.[0].entity, create.data.entity_id);
  await first.release(); assert.equal((await client.POST("/api/v1/search/evidence", { body: { context: first.context!, entities: [create.data.entity_id] } })).response.status, 404);
  const ordinary = await searchEntities(client, { format: "locus-native-tantivy-0.26", version: 2, text: "  " });
  assert.equal(ordinary.context, null); assert.equal(ordinary.entities.length, (await readEntityIds(client)).length); await ordinary.release();
  assert.equal((await client.POST("/api/v1/search/query", { body: { format: "future", version: 99, text: "" } })).response.status, 400);
  assert.equal((await client.POST("/api/v1/search/query", { body: {format:"locus-native-tantivy-0.26",version:2,text:"unknown:value"} })).response.status, 400);
  assert.equal((await client.POST("/api/v1/search/retry")).response.status, 202);
  assert.equal((await client.POST("/api/v1/search/rebuild")).response.status, 202);
  await delay(50); await ready(client, 2); assert.equal(first.entities.length, 1);
  await server.stop(); server = await fixture.start(); client = server.client; await ready(client, 2);
  assert.equal((await readEntityIds(client)).length, 2); await server.stop();
  // A cache path failure remains separate from ordinary library readiness.
  const cache = join(fixture.library, "cache", "search"); await rm(cache, { recursive: true, force: true }); await writeFile(cache, "unavailable cache path");
  server = await fixture.start(); client = server.client;
  for (let attempt = 0; attempt < 100; attempt++) { if ((await client.GET("/api/v1/search/status")).data?.state === "failed") break; await delay(20); }
  assert.equal((await client.GET("/api/v1/search/status")).data?.state, "failed"); assert.equal((await readEntityIds(client)).length, 2);
  await rm(cache); assert.equal((await client.POST("/api/v1/search/retry")).response.status, 202); await ready(client, 2); await server.stop();
  console.log("PASS real search catalogue/query/evidence/release/status/retry/rebuild, fixed packed observation, reopen, and search-only degradation with continued Entity reads.");
} finally { await fixture.dispose(); }
