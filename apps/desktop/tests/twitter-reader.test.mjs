import assert from "node:assert/strict"
import { test } from "node:test"
import { setImmediate as turn } from "node:timers/promises"
import { EntityReader } from "../src/renderer/entities/entity/model/entity-reader.ts"
import { twitterProjection, twitterProblems } from "../src/renderer/entities/entity/model/live-projection.ts"
import { availableViews } from "../src/renderer/pages/entity/model/content-views.ts"
import { ApiFailure, diagnosticText } from "../src/renderer/shared/api/backend-api.ts"
const kind = "88ace9d7-8f02-4cc6-8f5b-add4dc6faf51"
const tick = async () => { await turn(); await turn() }
const view = (id = "t", snapshot = { post_id: "1", text: "old" }) => ({
  record: { component_id: id, kind_id: kind, revision: "1", basis: null, snapshot },
  applicability: { status: "input", host: "e", comparison: { status: "incomplete", basis: null, current: { status: "missing_slot", entity_id: "e" } }, file_error: null },
})
function setup() {
  let membership = "t"
  const api = {
    memberships: async ids => ids.map(entity_id => ({ status: "present", entity_id, memberships: membership ? [{ entity_id, component_id: membership, kind_id: kind }] : [] })),
    twitter: async id => view(id),
  }
  const reader = new EntityReader(api)
  return { api, reader, membership: value => { membership = value } }
}
test("Twitter loading, failure, retained read, complete replacement and missing versus removed", async () => {
  const f = setup(); let resolve
  f.api.twitter = () => new Promise(r => { resolve = r })
  f.reader.demand(["e"]); await tick()
  assert.equal(availableViews(f.reader.get("e"))[0].id, "twitter.read")
  assert.equal(f.reader.get("e").components[0].readStatus, "loading")
  resolve(view()); await tick()
  f.api.twitter = async () => { throw new Error("offline") }
  await f.reader.reread("e"); await tick()
  assert.equal(f.reader.get("e").components[0].text, "old")
  assert.equal(f.reader.get("e").components[0].previous, true)
  f.api.twitter = async () => view("t", { post_id: "1", text: "", references: [], observed_at_unix_ms: "0" })
  await f.reader.reread("e"); await tick()
  assert.equal(f.reader.get("e").components[0].text, "")
  assert.equal(f.reader.get("e").components[0].author, undefined)
  assert.equal(f.reader.get("e").components[0].capturedAt, "1970-01-01T00:00:00.000Z")
  assert.deepEqual(f.reader.get("e").problems, [])
  f.api.twitter = async () => { throw new ApiFailure({ code: "operation_failed", message: "Missing", diagnostic: { owner: "twitter", error: { code: "missing_record", component_id: "t" } } },500) }
  await f.reader.reread("e"); await tick()
  assert.equal(f.reader.get("e").components[0].record, undefined)
  assert.equal(availableViews(f.reader.get("e"))[0].id, "twitter.read")
  f.membership(null); await f.reader.reread("e"); await tick()
  assert.deepEqual(f.reader.get("e").components, [])
  assert.deepEqual(availableViews(f.reader.get("e")), [])
})
test("first failure and component replacement never impersonate an older capture; late results are ignored", async () => {
  const f=setup()
  f.api.twitter=async()=>{ throw new Error("initial") }
  f.reader.demand(["e"]); await tick()
  assert.equal(f.reader.get("e").components[0].previous,false)
  let finish
  f.api.twitter=()=>new Promise(r=>{finish=r})
  void f.reader.reread("e");await tick()
  f.membership("replacement");f.api.twitter=async id=>view(id,{post_id:"2"})
  await f.reader.reread("e");await tick()
  finish(view());await tick()
  assert.equal(f.reader.get("e").components[0].id,"replacement")
  assert.equal(f.reader.get("e").components[0].text,undefined)
})
test("provider roles and independently scoped issues survive comparison matches", () => {
  const v=view("t", { post_id:"1", text:null, references:[], requested_url:"https://x.com/request", representation:{claims:{duration_ms:"9007199254740993"}}, issues:[{portion:"remote_preview",code:"unavailable",message:"blocked"}] })
  v.record.basis="file";v.applicability.comparison={status:"matching",file_id:"file"};v.applicability.file_error={kind:"domain",message:"Missing File record"}
  assert.equal(twitterProblems(v,"e").length,2)
  v.applicability.file_error=null
  assert.equal(twitterProblems(v,"e").length,1)
  v.record.snapshot.issues=[]
  assert.equal(twitterProblems(v,"e").length,0)
  v.applicability.host="other"
  assert.match(twitterProblems(v,"e")[0].message,/other/)
  assert.equal(twitterProjection(v).record.snapshot.representation.claims.duration_ms,"9007199254740993")
  assert.equal(twitterProjection(v).text,undefined)
  assert.match(diagnosticText({owner:"twitter",error:{code:"payload_version",version:99}}),/twitter: Unsupported payload version 99/)
})

test("wrong component and kind attribution fail without adopting another payload", async () => {
  const f=setup(); f.api.twitter=async()=>view("wrong")
  f.reader.demand(["e"]);await tick()
  assert.equal(f.reader.get("e").components[0].id,"t")
  assert.equal(f.reader.get("e").components[0].record,undefined)
  assert.match(f.reader.get("e").problems[0].message,/did not match/)
  f.api.twitter=async()=>({...view(),record:{...view().record,kind_id:"other-kind"}})
  await f.reader.reread("e");await tick()
  assert.equal(f.reader.get("e").components[0].record,undefined)
})
