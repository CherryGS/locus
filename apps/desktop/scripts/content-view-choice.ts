import type { Page } from "playwright"

export async function waitForContentViewSaved(page: Page) {
  await page.locator('[data-slot="entity-view-choice"][data-save-state="saved"]').waitFor()
}

export async function chooseContentView(page: Page, label: string) {
  await page.getByRole("combobox", { name: "Default view", exact: true }).click()
  await page.getByRole("option", { name: `Use ${label} view`, exact: true }).click()
  await page.getByRole("listbox").waitFor({ state: "hidden" })
}

export async function hasContentView(page: Page, label: string) {
  await page.getByRole("combobox", { name: "Default view", exact: true }).click()
  await page.getByRole("listbox").waitFor()
  const available = (await page.getByRole("option", { name: `Use ${label} view`, exact: true }).count()) > 0
  await page.keyboard.press("Escape")
  await page.getByRole("listbox").waitFor({ state: "hidden" })
  return available
}
