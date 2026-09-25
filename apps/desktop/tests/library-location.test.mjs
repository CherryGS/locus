import assert from "node:assert/strict"
import { test } from "node:test"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { existingLibrary, librarySource, rememberLibrary } from "../src/main/library-location.ts"
import { relaunchArguments, startupLocator } from "../src/main/relaunch.ts"

test("library picker rejects missing or invalid database without initializing a folder", async () => {
  const root = await mkdtemp(join(tmpdir(), "locus-selection-"))
  try {
    await assert.rejects(existingLibrary(root), /existing Locus library/)
    await writeFile(join(root, "metadata.sqlite"), "not a database")
    await assert.rejects(existingLibrary(root), /readable library database/)
    await assert.rejects(existingLibrary("relative"), /absolute/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("remembered library replaces the existing path file; invalid locators cannot overwrite it", async () => {
  const root = await mkdtemp(join(tmpdir(), "locus-locator-"))
  try {
    const file = join(root, "config", "path")
    await rememberLibrary(root, file)
    const target = join(root, "other library")
    await mkdir(target)
    await rememberLibrary(target, file)
    assert.equal(await readFile(file, "utf8"), `${target}\n`)
    await assert.rejects(rememberLibrary(`${target}\nbad`, file))
    assert.equal(await readFile(file, "utf8"), `${target}\n`)
    const args = relaunchArguments(true, ["Locus"], resolve(target), true)
    assert.deepEqual(startupLocator(args), {
      libraryRoot: resolve(target),
      requireExisting: true,
      remember: true,
    })
    assert.throws(() => startupLocator(["--locus-remember-library"]))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test("library source follows startup precedence and distinguishes path-file from default", async () => {
  const root = await mkdtemp(join(tmpdir(), "locus-source-"))
  try {
    const file = join(root, "path")
    assert.deepEqual(await librarySource(undefined, null, file), { kind: "default" })
    await writeFile(file, "\uFEFF  " + root + "\nignored second line")
    assert.deepEqual(await librarySource(undefined, null, file), { kind: "path-file", name: file })
    assert.deepEqual(await librarySource(undefined, root, file), {
      kind: "environment",
      name: "LOCUS_DATA_DIR",
    })
    assert.deepEqual(await librarySource({ libraryRoot: root, requireExisting: true }, root, file), {
      kind: "startup",
    })
    assert.deepEqual(
      await librarySource({ libraryRoot: root, requireExisting: true, remember: true }, root, file),
      { kind: "selection" },
    )
    await writeFile(file, "  \n" + root)
    assert.deepEqual(await librarySource(undefined, null, file), { kind: "default" })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
