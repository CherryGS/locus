import { chooseContentView } from "./content-view-choice.ts"
import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { join } from "node:path"
import { writeFile } from "node:fs/promises"
import { _electron as electron } from "playwright"
import { twitterFixture } from "./twitter-fixture.ts"
import { desktop, binary, outputDirectory } from "./fixture.ts"
const require = createRequire(import.meta.url)
const data = await twitterFixture(true), output = await outputDirectory("twitter-native")
let application: Awaited<ReturnType<typeof electron.launch>> | undefined
try {
  const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string,string] => typeof e[1] === "string"))
  delete env.ELECTRON_RUN_AS_NODE
  application = await electron.launch({executablePath: require("electron"), args:[join(desktop,"scripts/electron-test-entry.cjs")], env:{...env,LOCUS_DATA_DIR:data.library,LOCUS_SERVER_BINARY:binary,LOCUS_DESKTOP_HIDDEN:"1",LOCUS_TEST_EXTERNAL_LINKS:"1"}})
  const page = await application.firstWindow(); page.setDefaultTimeout(15000)
  const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message))
  await page.getByRole("grid",{name:"Entities"}).waitFor()
  assert.equal(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false)
  const complete=data.entries.find(e=>e.name==="complete")!
  await page.locator(`[role="gridcell"][id$="-${complete.entityId}"]`).dblclick()
  await page.getByRole("button",{name:"Overview",exact:true}).click()
  await chooseContentView(page, "Twitter")
  await page.getByRole("article").waitFor()
  const url=page.url()
  const link=page.getByRole("article").getByRole("link",{name:"View original post",exact:true})
  const articleBefore = await page.getByRole("article").boundingBox()
  await link.click()
  await page.getByRole("button",{name:"Retry opening link",exact:true}).waitFor()
  await page.locator('[data-slot="toast"]').getByText("Couldn't open link", { exact: true }).waitFor()
  assert.equal(await page.getByRole("article").locator('[data-slot="toast"]').count(), 0)
  assert.deepEqual(await page.getByRole("article").boundingBox(), articleBefore, "link feedback must not reflow source content")
  const calls=()=>application!.evaluate(()=>(globalThis as any).__desktopTest.externalLinks)
  assert.equal((await calls()).length,1,"anchor default must not duplicate native invocation")
  assert.equal(page.url(),url)
  const capture = await application.evaluate(async ({BrowserWindow}) => (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString("base64"))
  await writeFile(join(output,"handoff-failed.png"), Buffer.from(capture,"base64"))
  await application.evaluate(()=>{(globalThis as any).__desktopTest.rejectExternal=false})
  await page.getByRole("button",{name:"Retry opening link",exact:true}).click()
  await page.getByRole("button",{name:"Retry opening link",exact:true}).waitFor({state:"detached"})
  assert.equal((await calls()).length,2)
  assert.equal(page.url(),url)
  for(const target of ["file:///private","https://user:password@x.com/post","javascript:alert(1)","invalid"]){
    const result=await page.evaluate(target=>window.locusDesktop!.openExternalLink(target),target)
    assert.equal(result.status,"failed");assert.equal(result.url,target)
  }
  assert.equal((await calls()).length,2)
  assert(await application.evaluate(async({ipcMain,BrowserWindow})=>{
    const handler=(ipcMain as any)._invokeHandlers.get("locus:open-external-link")
    try { await handler({sender:BrowserWindow.getAllWindows()[0].webContents,senderFrame:{}},"https://x.com/post"); return false } catch { return true }
  }))
  // A real delayed native response must not report failure on a new Entity.
  await application.evaluate(() => { (globalThis as any).__desktopTest.holdExternal = true })
  await link.click()
  await page.getByRole("button", {name:"Next entity",exact:true}).click()
  await page.waitForFunction(id => document.querySelector('[data-slot="entity-inspection"]')?.getAttribute("data-entity-id") !== id, complete.entityId)
  await application.evaluate(() => { const test = (globalThis as any).__desktopTest; test.holdExternal = false; test.externalRejections.shift()() })
  assert.equal(await page.getByRole("button",{name:"Retry opening link",exact:true}).count(),0)
  await page.getByRole("button",{name:"Back",exact:true}).click()
  await page.locator(`[data-slot="entity-inspection"][data-entity-id="${complete.entityId}"]`).waitFor()
  // Actual local Video departure for Twitter releases playback and returns paused.
  await chooseContentView(page, "Video")
  await page.locator('[data-slot="video-viewport"][data-state="ready"]').waitFor()
  await page.locator("video").evaluate(async (video: HTMLVideoElement) => { video.currentTime = 2; await video.play(); (window as any).__departedTwitterVideo = video })
  await page.waitForFunction(() => !document.querySelector("video")!.paused)
  await chooseContentView(page, "Twitter")
  assert(await page.evaluate(() => (window as any).__departedTwitterVideo.paused))
  await chooseContentView(page, "Video")
  await page.locator('[data-slot="video-viewport"][data-state="ready"]').waitFor()
  assert(await page.locator("video").evaluate((video: HTMLVideoElement) => video.paused && video.currentTime >= 1.8))
  await chooseContentView(page, "Twitter")
  // Changing view must leave link-action feedback behind without changing record problems.
  await application.evaluate(()=>{(globalThis as any).__desktopTest.rejectExternal=true})
  await link.click();await page.getByRole("button",{name:"Retry opening link",exact:true}).waitFor()
  await chooseContentView(page, "Image")
  await chooseContentView(page, "Twitter")
  assert.equal(await page.locator('[data-slot="toast"]:not([data-ending-style])').count(), 0)
  await page.getByRole("button",{name:"Retry opening link",exact:true}).waitFor({state:"detached", timeout:1500})
  assert.equal(await page.getByRole("button",{name:"Retry opening link",exact:true}).count(),0)
  assert.equal(page.url(),url)
  assert.equal(await page.locator('[data-slot="entity-inspection"]').getAttribute("data-entity-id"),complete.entityId)
  await page.getByRole("status", { name: "Choice saved", exact: true }).waitFor()
  assert.deepEqual(errors,[])
  const links=await calls()
  const closed=application.waitForEvent("close")
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close())
  await closed;application=undefined
  await writeFile(join(output,"results.json"),JSON.stringify({passed:true,singleLaunch:true,invalidRefused:true,untrustedRefused:true,links,errors},null,2))
  console.log(JSON.stringify({output,passed:true}))
} finally {
  if(application) await application.evaluate(({app})=>{for(const child of (globalThis as any).__desktopTest.children)if(child.exitCode===null)child.kill();app.exit(1)}).catch(()=>{})
  await data.dispose()
}
