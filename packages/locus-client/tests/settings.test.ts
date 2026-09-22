import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp,writeFile,readFile,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMediaToolPathsDefaults, type MediaToolPaths } from "../src/index.js";
// The generator is plain JavaScript so it also runs outside the TS consumer.
// @ts-expect-error generator is an executable build script without a TS declaration
import { generate,parseExact } from "../scripts/generate-settings.mjs";
test("typed defaults are fresh and structurally complete",()=>{
  const first:MediaToolPaths=createMediaToolPathsDefaults();const next=createMediaToolPathsDefaults();
  assert.deepEqual(first,next);first.ffmpeg="changed";assert.notEqual(first.ffmpeg,next.ffmpeg);
  // @ts-expect-error complete values require both tool paths
  const incomplete:MediaToolPaths={ffprobe:"probe"};void incomplete;
  // @ts-expect-error tool path values are strings
  const invalid:MediaToolPaths={ffprobe:3,ffmpeg:"encoder"};void invalid;
});
test("exact parser rejects unsupported numeric defaults",()=>{
  assert.deepEqual(parseExact('{"n":1.0,"nested":[null,[],""]}'),{n:1,nested:[null,[],""]});
  for (const input of ['{"n":9007199254740993}','{"n":1e400}','{"n":0.123456789012345678901}']) assert.throws(()=>parseExact(input),/Unsupported numeric/);
});
test("generation preserves nested defaults, creates fresh values and rejects name collisions",async()=>{
  const root=await mkdtemp(join(tmpdir(),"locus-settings-generator-"));
  try {
    const input=join(root,"input.json"),output=join(root,"output.ts");
    const value={empty:"",none:null,nested:[[],["same"]]};
    const definition={group_id:"test",name:"NestedValues",version:1,schema:{title:"InternalRenamedValue",type:"object",properties:{empty:{type:"string"},none:{type:"null"},nested:{type:"array",items:{type:"array",items:{type:"string"}}}},required:["empty","none","nested"],additionalProperties:false},defaults:value};
    await writeFile(input,JSON.stringify([definition]));await generate(input,output);const first=await readFile(output,"utf8");assert.match(first,/export interface NestedValues/);assert.doesNotMatch(first,/interface InternalRenamedValue/);
    execFileSync(process.execPath,[fileURLToPath(new URL("../node_modules/typescript/bin/tsc",import.meta.url)),"--strict","--noEmit","--skipLibCheck",output],{cwd:root,windowsHide:true});
    await generate(input,output);assert.equal(first,await readFile(output,"utf8"));
    const expression=first.match(/return (JSON.parse\(.+\));/);assert(expression);const factory=new Function(`return ${expression[1]}`) as ()=>typeof value;
    const a=factory(),b=factory();assert.deepEqual(a,value);a.nested[1].push("changed");assert.deepEqual(b,value);
    await writeFile(input,JSON.stringify([definition,{...definition,group_id:"another"}]));await assert.rejects(()=>generate(input,output),/Conflicting/);
  } finally { await rm(root,{recursive:true,force:true}); }
});
