import type { Page } from 'playwright';

/** Runs current focused UI and retained legacy packaged builds through their actual navigation. */
export async function openRecovery(page: Page) {
  if (await page.getByTestId('nav-portability-btn').isVisible()) {
    await page.getByTestId('nav-portability-btn').click(); return;
  }
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const section = page.getByRole('button', { name: 'Backups & import / export', exact: true });
  if (await section.isVisible()) await section.click();
  await page.getByTestId('nav-portability-btn').click();
}
export async function showClassTools(page: Page) {
  const tools = page.getByRole('button', { name: 'Attendance & seating tools', exact: true });
  if (await tools.isVisible() && await tools.getAttribute('aria-pressed') !== 'true') await tools.click();
}
export async function openAssignmentCreation(page: Page) {
  await page.getByRole('button', { name: /^(Create Assignment|New Assessment)$/ }).click();
  const dialog = page.getByTestId('create-assignment-modal');
  return await dialog.isVisible() ? dialog.locator('form') : page.getByRole('heading', { name: 'Create New Assessment', exact: true }).locator('..').locator('form');
}

export async function openSettingsSection(page: Page, name: string) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const section = page.getByRole('button', { name, exact: true });
  if (await section.isVisible()) await section.click();
}
