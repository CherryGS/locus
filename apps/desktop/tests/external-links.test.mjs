import assert from "node:assert/strict"
import { test } from "node:test"
import { externalLinkHandler, openExternalLink } from "../src/main/external-links.ts"

test("web links go to the supplied browser opener without creating an Electron window", () => {
  const opened = []
  const handle = externalLinkHandler(async (url) => { opened.push(url) })
  const urls = ["https://x.com/locus_demo", "http://example.com/source?id=123"]
  for (const url of urls) assert.deepEqual(handle({ url }), { action: "deny" })
  assert.deepEqual(opened, urls)
})

test("captured links cannot invoke OS protocols, local files or credential-bearing URLs", () => {
  const opened = []
  const handle = externalLinkHandler(async (url) => { opened.push(url) })
  for (const url of ["file:///E:/library", "javascript:alert(1)", "data:text/html,test", "mailto:example@example.com", "/relative", "not a URL", "https://user:secret@example.com/"]) {
    assert.deepEqual(handle({ url }), { action: "deny" })
  }
  assert.deepEqual(opened, [])
})

test("explicit native web action reports exact target and observed handoff outcome", async () => {
  const calls=[]
  const open=async url=>{calls.push(url)}
  assert.deepEqual(await openExternalLink("https://x.com/post",open),{url:"https://x.com/post",status:"handed_off"})
  for(const url of ["file:///secret", "javascript:alert(1)", "https://user:pass@x.com", "bad", null])
    assert.equal((await openExternalLink(url,open)).status,"failed")
  assert.equal(calls.length,1)
  assert.equal((await openExternalLink("https://x.com/post",async()=>{throw Error("rejected")})).status,"failed")
})
