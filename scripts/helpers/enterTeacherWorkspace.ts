import type { Page } from 'playwright';
/** Current desktop startup has a role choice; retained legacy installers do not. */
export async function enterTeacherWorkspace(page: Page) {
  await page.waitForURL('file://**');
  await page.waitForLoadState('domcontentloaded');
  if (new URL(page.url()).pathname.endsWith('/roles.html')) {
    await page.getByRole('button', { name: 'Teacher Open your classroom workspace', exact: true }).click();
  }
}
