import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"
import { readEntityIds } from "@locus/client"
import { chromium, type Page } from "playwright"
import { startServer, workspace } from "./fixture.ts"
import { browserPreview } from "./browser-preview.ts"
import { generateSampleLibrary } from "./sample-library-generate.ts"
import type { Manifest } from "./sample-library-session.ts"
import { verifySampleTags } from "./sample-library-tags.ts"

export async function verifySampleLibrary(root: string) {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as Manifest
  const output = join(root, "verification")
  await mkdir(output, { recursive: true })
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ status: "RUNNING", startedAt: new Date().toISOString() }, null, 2),
  )
  const hash = async () =>
    createHash("sha256")
      .update(await readFile(join(manifest.library, "metadata.sqlite")))
      .digest("hex")
  const before = await hash()
  await assert.rejects(generateSampleLibrary(root), /Refusing nonempty sample output/)
  assert.equal(await hash(), before, "Refused generation must not alter database bytes")
  const database = await promisify(execFile)(
    "uv",
    [
      "run",
      "python",
      "-c",
      [
        "import sqlite3, json, sys, pathlib",
        "p = pathlib.Path(sys.argv[1]).resolve()",
        "c = sqlite3.connect(p.as_uri() + '?mode=ro', uri=True)",
        "tables = [r[0] for r in c.execute(\"select name from sqlite_master where type='table' order by name\")]",
        "assert all(t.startswith('locus_') or t.startswith('sqlite_') for t in tables), tables",
        "history = list(c.execute('select id, checksum, name, applied_at from locus_migration_comm_history order by id'))",
        "assert history",
        "assert c.execute('pragma integrity_check').fetchone()[0] == 'ok'",
        "print(json.dumps({'tables': tables, 'history': history, 'integrity': 'ok'}))",
      ].join("\n"),
      join(manifest.library, "metadata.sqlite"),
    ],
    { cwd: workspace, windowsHide: true },
  )
  const evidence: Record<string, unknown> = {
    overwriteRefusal: { databaseSha256: before, unchanged: true },
    database: JSON.parse(database.stdout),
    cases: [],
  }
  const reports = evidence.cases as unknown[]
  const server = await startServer(manifest.library, undefined, manifest.providerConfig, true)
  try {
    const client = server.client
    const identities = await readEntityIds(client)
    evidence.entityCount = identities.length
    evidence.entityIds = Array.from({ length: identities.length }, (_, i) => identities.at(i))
    const memberships = await client.POST("/api/v1/memberships/read", {
      body: { entity_ids: manifest.cases.map((e) => e.entityId) },
    })
    assert(memberships.data)
    const coverEntities: string[] = [],
      coverFiles: string[] = [],
      partCids: string[] = []
    const savedPreview = async (kind: "image" | "video", component_id: string, changed = false) => {
      const view = await client.GET("/api/v1/media/{kind}/{component_id}/view", {
        params: { path: { kind, component_id } },
      })
      assert(view.data?.record.facts, JSON.stringify(view))
      const preview = await client.GET("/api/v1/media/{kind}/{component_id}/saved-preview", {
        params: { path: { kind, component_id } },
      })
      if (changed) {
        assert.equal(view.data.applicability.status, "changed")
        assert.equal(preview.data, null, "Old basis must not supply the replacement File preview")
        return {
          facts: view.data.record.facts,
          applicability: view.data.applicability,
          preview: null,
        }
      }
      assert(preview.data, JSON.stringify(preview))
      const bytes = await client.GET("/api/v1/previews/{locator}/bytes", {
        params: { path: { locator: preview.data.locator } },
        parseAs: "arrayBuffer",
      })
      assert(bytes.response.ok && bytes.data && bytes.data.byteLength > 0)
      return {
        facts: view.data.record.facts,
        preview: preview.data,
        previewBytes: bytes.data.byteLength,
      }
    }
    for (const entry of manifest.cases) {
      assert(identities.indexOf(entry.entityId) >= 0, entry.name)
      const member = memberships.data.find((m) => m.entity_id === entry.entityId)
      assert(member?.status === "present", entry.name)
      if (entry.fileId) {
        assert(
          member.memberships.some((m) => m.component_id === (entry.currentFileId ?? entry.fileId)),
          entry.name,
        )
        const file = await client.GET("/api/v1/files/{file_id}", {
          params: { path: { file_id: entry.currentFileId ?? entry.fileId } },
        })
        assert(file.data, entry.name)
      }
      const preference = await client.GET("/api/v1/entities/{entity_id}/view-preference", {
        params: { path: { entity_id: entry.entityId } },
      })
      assert(
        preference.data?.status === "saved" && preference.data.view_definition_id === entry.view,
        entry.name,
      )
      const report: Record<string, unknown> = {
        name: entry.name,
        entityId: entry.entityId,
        preference: entry.view,
        media: [],
      }
      for (const media of entry.result.kinds.filter((k) => k.component_id))
        (report.media as unknown[]).push(
          await savedPreview(media.kind, media.component_id!, !!entry.currentFileId),
        )
      if (entry.name.startsWith("image/") && entry.name !== "image/unsupported")
        assert(
          entry.result.kinds.some((k) => k.kind === "image" && k.component_id),
          entry.name,
        )
      if (entry.name.startsWith("video/"))
        assert(
          entry.result.kinds.some((k) => k.kind === "video" && k.component_id),
          entry.name,
        )
      if (entry.name === "image/unsupported" || entry.name === "model/malformed") {
        assert(!entry.result.kinds.some((k) => k.component_id), entry.name)
        assert(!entry.result.model.component_id, entry.name)
        report.unrecognized = true
      }
      if (entry.result.model.component_id) {
        const model = await client.GET("/api/v1/models/{component_id}/view", {
          params: { path: { component_id: entry.result.model.component_id } },
        })
        assert(model.data?.record.facts?.tensor_count, entry.name)
        report.model = model.data
      }
      if (entry.name === "model/local-unmatched") {
        assert(entry.result.model.component_id)
        assert.equal(entry.result.civitai?.metadata, "no_match")
      }
      if (entry.result.twitter_id) {
        const twitter = await client.GET("/api/v1/twitter/{component_id}/view", {
          params: { path: { component_id: entry.result.twitter_id } },
        })
        assert(twitter.data?.applicability.status === "input", entry.name)
        assert.equal(
          twitter.data.applicability.comparison.status,
          entry.name === "twitter/changed-file"
            ? "changed"
            : entry.fileId
              ? "matching"
              : "incomplete",
          entry.name,
        )
        report.twitter = twitter.data
      }
      if (entry.result.civitai?.component_id) {
        const component_id = entry.result.civitai.component_id
        const civitai = await client.GET("/api/v1/civitai/{component_id}/page", {
          params: { path: { component_id } },
        })
        assert(civitai.data?.origin.input === "current", entry.name)
        const version = await client.GET("/api/v1/civitai/{component_id}/version", {
          params: {
            path: { component_id },
            query: { version: civitai.data.origin.record.matched_version },
          },
        })
        assert(version.data, entry.name)
        for (const example of version.data.examples) {
          assert(example.applicable && example.binding.complete, entry.name)
          for (const media of example.binding.media)
            await savedPreview(media.kind, media.component_id)
        }
        if (entry.name === "retained/EasyNegative") {
          assert.equal(civitai.data.origin.record.model.id, "7808")
          assert.equal(civitai.data.origin.record.matched_version, "9208")
          assert.equal(version.data.examples.length, 4)
        }
        if (entry.name === "civitai/existing") assert.equal(version.data.examples.length, 0)
        report.civitai = { page: civitai.data, version: version.data }
      }
      if (entry.result.bilibili?.component_id) {
        const bilibili = await client.GET("/api/v1/bilibili/{component_id}/view", {
          params: {
            path: { component_id: entry.result.bilibili.component_id },
          },
        })
        assert(bilibili.data, JSON.stringify(bilibili.error))
        report.bilibili = bilibili.data
        const cover = entry.result.bilibili.cover
        if (entry.name.startsWith("bilibili/part-")) {
          assert(
            bilibili.data.applicability.status === "input" &&
              bilibili.data.applicability.comparison.status === "matching",
          )
          assert(
            bilibili.data.cover.status === "input" &&
              bilibili.data.cover.comparison.status === "matching",
          )
          assert(cover?.confirmed_entity_id && cover.image.component_id)
          coverEntities.push(cover.confirmed_entity_id)
          coverFiles.push(cover.file_id)
          partCids.push(bilibili.data.record.snapshot.part!.cid!)
        }
        if (cover?.image.component_id && entry.name !== "bilibili/unavailable-cover")
          report.cover = await savedPreview("image", cover.image.component_id)
        if (entry.name === "bilibili/unavailable-cover") assert.equal(entry.result.complete, false)
      }
      reports.push(report)
    }
    assert.equal(new Set(coverEntities).size, 3)
    assert.equal(new Set(coverFiles).size, 3)
    assert.equal(new Set(partCids).size, 3)
    evidence.multipart = { coverEntities, coverFiles, partCids }
    const find = (name: string) => {
      const entry = manifest.cases.find((e) => e.name === name)
      assert(entry, name)
      return entry
    }
    const a = find("civitai/A"),
      b = find("civitai/B"),
      c = find("civitai/C"),
      copy = find("civitai/A-copy"),
      other = find("civitai/existing")
    const component_id = a.result.civitai!.component_id!
    const page = await client.GET("/api/v1/civitai/{component_id}/page", {
      params: { path: { component_id } },
    })
    assert(page.data)
    assert.deepEqual(page.data.versions.map((v) => v.id).sort(), ["10", "20", "30"])
    assert.equal(page.data.versions.find((v) => v.id === "30")?.in_origin, false)
    assert.equal(page.data.correspondences.length, 4)
    assert(!page.data.correspondences.some((v) => v.source.entity_id === other.entityId))
    assert.notEqual(a.fileId, copy.fileId)
    const version = async (id: string, source?: string) => {
      const result = await client.GET("/api/v1/civitai/{component_id}/version", {
        params: { path: { component_id }, query: { version: id, source } },
      })
      assert(result.data, JSON.stringify(result.error))
      return result.data
    }
    const v10 = await version("10"),
      v20 = await version("20"),
      vb = await version("30", b.result.civitai!.component_id!),
      vc = await version("30", c.result.civitai!.component_id!)
    assert.equal(v10.examples.length, 6)
    assert.equal(new Set(v10.examples.map((e) => e.binding.entity_id)).size, 3)
    assert.equal(vb.examples.length, 6)
    assert.equal(new Set(vb.examples.map((e) => e.binding.entity_id)).size, 3)
    assert.equal(v20.examples.length, 0)
    assert.equal(v20.version.images.length, 1)
    assert.equal(vb.version.files[0].id, "300")
    assert.equal(vc.version.files[0].id, "301")
    const uniqueExamples = new Map(
      [...v10.examples, ...vb.examples].map((e) => [e.binding.entity_id, e]),
    )
    for (const example of uniqueExamples.values()) {
      assert(example.applicable && example.binding.complete)
      for (const media of example.binding.media) await savedPreview(media.kind, media.component_id)
    }
    const isolated = await client.GET("/api/v1/civitai/{component_id}/page", {
      params: { path: { component_id: other.result.civitai!.component_id! } },
    })
    assert.equal(isolated.data?.correspondences.length, 1)
    evidence.civitai = {
      page: page.data,
      version10: v10,
      listedVersion20: v20,
      sourceB: vb,
      sourceC: vc,
      isolated: isolated.data,
    }
    await writeFile(join(output, "retained-reads.json"), JSON.stringify(evidence, null, 2))
    const preview = await browserPreview(server)
    try {
      await verifyRenderer(manifest, preview.origin, output)
      await verifySampleTags(client, manifest, preview.origin, output)
    } finally {
      await preview.close()
    }
  } finally {
    await server.stop()
  }
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        status: "PASS",
        cases: manifest.cases.length,
        tagsVerified: true,
        reopened: true,
        overwriteRefusedWithoutMutation: true,
        ownedProcessesStopped: true,
      },
      null,
      2,
    ),
  )
  console.log("Verified retained library: " + root)
}

async function verifyRenderer(manifest: Manifest, origin: string, output: string) {
  const browser = await chromium.launch({ headless: true })
  try {
    const errors: string[] = [],
      remote: string[] = [],
      assertions: string[] = []
    const newPage = async () => {
      const next = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
      next.on("pageerror", (e) => errors.push(e.message))
      next.on("request", (request) => {
        if (new URL(request.url()).origin !== origin) remote.push(request.url())
      })
      return next
    }
    let page = await newPage()
    const find = (name: string) => {
      const entry = manifest.cases.find((e) => e.name === name)
      assert(entry)
      return entry
    }
    const open = async (name: string) => {
      const entry = find(name)
      // Match preview.md's new-tab guidance. A hash-only direct switch can retain
      // an existing Civitai excursion; this check makes no claim to fix that UI.
      const previous = page
      page = await newPage()
      await page.goto(`${origin}/#/entity?mode=inspect&entityId=${entry.entityId}`)
      await previous.close()
      await page
        .locator(
          `[data-slot="entity-inspection"][data-entity-id="${entry.entityId}"][data-view-id="${entry.view}"]`,
        )
        .waitFor()
        .catch(async (error) => {
          const diagnostics = join(output, "diagnostics")
          await mkdir(diagnostics, { recursive: true })
          await page.screenshot({ path: join(diagnostics, "failed-entry.png") })
          await writeFile(
            join(diagnostics, "failed-entry.json"),
            JSON.stringify(
              { url: page.url(), body: await page.locator("body").innerText(), errors },
              null,
              2,
            ),
          )
          throw error
        })
      return entry
    }
    const screenshot = async (name: string) =>
      page.screenshot({ path: join(output, name + ".png") })
    await page.goto(origin + "/#/entity")
    await page.getByRole("gridcell").first().waitFor()
    await screenshot("library")
    await page.getByRole("gridcell").first().dblclick()
    await page.locator('[data-slot="entity-inspection"]').waitFor()
    assertions.push(
      "Ordinary library card opens inspection; named case links enter fresh documents",
    )
    await open("file/metadata.json")
    await screenshot("file")
    await open("image/landscape")
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[data-slot="entity-inspection"] img')].some(
        (i) => (i as HTMLImageElement).naturalWidth >= 960,
      ),
    )
    await screenshot("image")
    assertions.push("Image viewer displays decoded managed original")
    await open("model/local-unmatched")
    await page.getByRole("button", { name: /Read declarations/ }).click()
    await page.getByText("Local unmatched sample", { exact: true }).waitFor()
    await page.getByRole("button", { name: "Explore tensors", exact: true }).click()
    await page.getByRole("button", { name: /encoder.weight/ }).click()
    await screenshot("model")
    assertions.push("Model declarations and tensor inspector read accepted SafeTensors facts")
    await open("twitter/image-one")
    await page
      .getByText(
        "Offline field notes · three independently captured media items from the same post",
        { exact: true },
      )
      .waitFor()
    await screenshot("twitter")
    for (const name of [
      "video/landscape",
      "video/portrait",
      "bilibili/part-1",
      "bilibili/part-2",
      "bilibili/part-3",
    ]) {
      await open(name)
      await playback(page)
      if (name.startsWith("bilibili/")) {
        const image = page.locator('img[alt="Saved Bilibili original cover"]')
        await image.waitFor({ state: "attached" })
        await page.waitForFunction(() => {
          const i = document.querySelector(
            'img[alt="Saved Bilibili original cover"]',
          ) as HTMLImageElement
          return i?.complete && i.naturalWidth > 0
        })
        const number = Number(name.at(-1))
        await page
          .getByText(["", "Landscape and sound", "Portrait motion", "Square color study"][number], {
            exact: true,
          })
          .waitFor()
      }
      await screenshot(name.replaceAll("/", "-"))
      assertions.push(name + ": manual playback advances; retained metadata/artwork readable")
    }
    await open("bilibili/unavailable-cover")
    await playback(page)
    await screenshot("unavailable-cover")
    await open("civitai/A")
    const reading = page.locator('[data-slot="civitai-page"]')
    await reading.getByText("A independent model description", { exact: true }).waitFor()
    await reading
      .getByRole("button", {
        name: "Version 30 · not recorded in this snapshot",
        exact: true,
      })
      .click()
    for (const name of ["B", "C"]) {
      await reading
        .getByRole("button", {
          name: `Source Entity ${find("civitai/" + name).entityId.slice(-8)}`,
          exact: true,
        })
        .click()
      await reading.getByText(`${name} version description`, { exact: true }).waitFor()
      assert(
        await reading.getByText("A independent model description", { exact: true }).isVisible(),
      )
      await screenshot("civitai-source-" + name)
    }
    await reading
      .getByRole("button", { name: "Inspect managed example", exact: true })
      .first()
      .click()
    await page.locator('[data-slot="entity-inspection"][data-view-id="image.inspect"]').waitFor()
    await screenshot("civitai-example")
    await page.getByRole("button", { name: "Return to source", exact: true }).first().click()
    await reading.getByText("C version description", { exact: true }).waitFor()
    await reading.getByRole("button", { name: /Version 20$/ }).click()
    await screenshot("civitai-listed-unadmitted")
    assertions.push(
      "Civitai peer versions and explicit sources retain origin model notes; managed example inspection returns to selected source",
    )
    if (manifest.retainedInputs) {
      await open("retained/EasyNegative")
      await page.locator('[data-slot="civitai-gallery-stage"] img').waitFor()
      await screenshot("retained-easynegative")
      await open("retained/bilibili-multipart-2")
      await playback(page)
      await screenshot("retained-bilibili")
      assertions.push("Retained real EasyNegative previews and Bilibili part playback")
    }
    assert.deepEqual(errors, [])
    assert.deepEqual(remote, [], "Renderer must not load observed remote source URLs")
    await writeFile(
      join(output, "renderer.json"),
      JSON.stringify({ assertions, errors, remoteRequests: remote }, null, 2),
    )
  } finally {
    await browser.close()
  }
}
async function playback(page: Page) {
  await page.locator('[data-slot="video-viewport"][data-state="ready"]').waitFor()
  const video = page.locator("video")
  assert(await video.evaluate((v: HTMLVideoElement) => v.paused))
  await video.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true
    await v.play()
  })
  await page.waitForFunction(() => (document.querySelector("video")?.currentTime ?? 0) > 0.25)
  await video.evaluate((v: HTMLVideoElement) => v.pause())
}
