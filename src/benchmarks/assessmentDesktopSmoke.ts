import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import path from 'path';

const executablePath = path.resolve('release/win-unpacked/Ontario Teacher Assessment.exe');
const assessmentTitle = `QA Fictional Assessment ${Date.now()}`;

async function openAssessmentHub(page: Page) {
  await page.locator('[data-testid="teacher-selector-modal"]').waitFor({ state: 'visible', timeout: 20000 });
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await page.locator('[data-testid="teacher-selector-modal"]').waitFor({ state: 'hidden' });

  await page.locator('[data-testid="nav-dashboard-btn"]').click();
  await page.locator('[data-testid="chiclet-open-overlay-btn"]').first().click();
  await page.locator('button[title="Manage Assessments & Rubrics"]').click();
  await page.getByRole('heading', { name: 'Central Assessment Hub & Rubrics' }).waitFor({ state: 'visible' });
}

async function main() {
  let app: ElectronApplication | undefined;
  const pageErrors: string[] = [];

  try {
    app = await electron.launch({ executablePath });
    let page = await app.firstWindow();
    page.on('pageerror', error => pageErrors.push(error.message));
    await openAssessmentHub(page);

    await page.getByRole('button', { name: 'New Assessment' }).click();
    const form = page.getByRole('heading', { name: 'Create New Assessment' }).locator('..').locator('form');
    if (await form.getByText('Code', { exact: true }).count()) {
      throw new Error('Create Assessment still asks the teacher for a code.');
    }
    await form.getByPlaceholder('e.g. Comparative Synthesis Essay').fill(assessmentTitle);
    await form.getByRole('button', { name: 'Create Assessment' }).click();
    await page.getByRole('heading', { name: assessmentTitle }).waitFor({ state: 'visible' });

    await app.close();
    app = undefined;

    app = await electron.launch({ executablePath });
    page = await app.firstWindow();
    page.on('pageerror', error => pageErrors.push(error.message));
    await openAssessmentHub(page);
    await page.getByRole('heading', { name: assessmentTitle }).waitFor({ state: 'visible' });

    if (pageErrors.length) throw new Error(`Desktop page errors: ${pageErrors.join('; ')}`);
    console.log('PASS: Packaged desktop app created an assessment without a code field and retained its title after restart.');
  } finally {
    await app?.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
