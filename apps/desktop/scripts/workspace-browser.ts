import assert from "node:assert/strict"
import type { Locator, Page } from "playwright"

export const activeWorkspacePage = (page: Page) => page.locator('[data-workspace-page][data-active="true"]')
export async function workspaceLocation(page: Page) {
  return (await activeWorkspacePage(page).locator('[data-page-location]').getAttribute('data-page-location'))!
}
export async function workspaceVisit(page: Page) {
  const root = activeWorkspacePage(page).locator('[data-page-location]')
  return { key: await root.getAttribute('data-history-index'), length: await root.getAttribute('data-history-length'), location: await root.getAttribute('data-page-location') }
}
export async function waitWorkspaceLocation(page: Page, pattern: RegExp) {
  await page.waitForFunction(({ source, flags }) => new RegExp(source, flags).test(
    document.querySelector('[data-workspace-page][data-active="true"] [data-page-location]')?.getAttribute('data-page-location') ?? ""
  ), { source: pattern.source, flags: pattern.flags })
}
// Explicit isolated starting states use a new document. Hash changes within an
// existing document cannot control an already-created workspace page router.
export async function freshWorkspaceEntry(page: Page, url: string) {
  await page.goto("about:blank")
  await page.goto(url)
}
export type WorkspaceTabHandle = { id: string; label: string; domId: string }
export async function openWorkspaceEntry(page: Page, name: "Media" | "Models" | "All content" | "Tags" | "Import" | "Settings", hiddenHost = false) {
  const launcher = page.getByRole("button", { name: "Locus", exact: true })
  // A hidden native host may suspend stable-frame actionability before its first
  // frame. Browser checks cover pointer interaction; host checks activate the
  // same DOM controls without exposing a window on the user's desktop.
  if (hiddenHost) await launcher.evaluate((element: HTMLButtonElement) => element.click())
  else await launcher.click()
  const entry = page.getByRole("menuitem", { name, exact: true })
  if (hiddenHost) await entry.evaluate((element: HTMLElement) => element.click())
  else await entry.click()
}
export async function activeTab(page: Page) {
  const tab = page.locator('[role="tab"][aria-selected="true"]')
  await tab.waitFor({ state: "attached" })
  const label = (await tab.textContent())!.trim()
  const id = await activeWorkspacePage(page).getAttribute("data-page-id")
  const domId = await tab.getAttribute("id")
  assert(id && domId)
  return { label, id, domId }
}
const tabLocator = (page: Page, target: string | WorkspaceTabHandle) => typeof target === "string"
  ? page.getByRole("tab", { name: target, exact: true })
  : page.locator(`[role="tab"][id="${target.domId}"]`)
export async function activateTab(page: Page, target: string | WorkspaceTabHandle) {
  const tab = tabLocator(page, target)
  await tab.click()
  const id = await tab.getAttribute("id")
  assert(id)
  await page.waitForFunction(value => document.getElementById(value)?.getAttribute("aria-selected") === "true", id)
}
export async function closeTab(page: Page, target: string | WorkspaceTabHandle) {
  await tabLocator(page, target).locator("..").getByRole("button", { name: /^Close / }).click()
}
export async function waitForEntityCount(root: Locator, count: number) {
  if (count) await root.locator(`[data-entity-count="${count}"]`).waitFor()
  else await root.getByText("No matches", { exact: true }).waitFor()
}
export async function searchWorkspace(page: Page, source: string, count: number) {
  const root = activeWorkspacePage(page)
  const input = root.getByRole("textbox", { name: "Search entities", exact: true })
  await input.fill(source)
  await input.press("Enter")
  await waitForEntityCount(root, count)
}
export async function inspectWorkspaceEntity(page: Page, id: string) {
  await activeWorkspacePage(page).locator(`[role="gridcell"][data-entity-id="${id}"]`).dblclick()
  await activeWorkspacePage(page).locator(`[data-slot="entity-inspection"][data-entity-id="${id}"]`).waitFor()
}
export async function openWorkspaceNotes(page: Page) {
  const root = activeWorkspacePage(page)
  const overview = root.getByRole("complementary", { name: "Overview", exact: true })
  if (!await overview.isVisible()) await root.getByRole("button", { name: "Overview", exact: true }).click()
  const notes = overview.getByRole("textbox", { name: "Notes", exact: true })
  await notes.waitFor()
  await page.waitForFunction(() => {
    const input = document.querySelector<HTMLTextAreaElement>('[data-workspace-page][data-active="true"] section[aria-label="Entity notes"] textarea')
    return input && !input.disabled
  })
  return notes
}
