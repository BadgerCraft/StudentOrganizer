import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { preview } from 'vite';
import { chromium, webkit, type Page } from 'playwright';
import { runUiAssessmentAcceptance } from './uiAssessmentAcceptance';
import { runUiPhotoRosterAcceptance } from './uiPhotoRosterAcceptance';
import { runUiSettingsAcceptance } from './uiSettingsAcceptance';

// Production build, disposable fictional profiles, real UI writes and
// read-only database observations. Browser evidence is not native-device QA.
const engine = process.env.UI_TEST_BROWSER === 'webkit' ? webkit : chromium;
const origin = 'http://127.0.0.1:4198';
const directory = `screenshots/ui-repairs-${engine.name()}`;
mkdirSync(directory, { recursive: true });
const server = await preview({ preview: { host: '127.0.0.1', port: 4198, strictPort: true } });
const browser = await engine.launch({ headless: true });
const completed: string[] = [];
const failures: { task: string; error: string }[] = [];

async function teacherConfirmation(page: Page) {
  const teacher = page.locator('[data-testid^="select-teacher-"]').first();
  await teacher.waitFor();
  const teacherId = (await teacher.getAttribute('data-testid'))!.replace('select-teacher-', '');
  assert.equal(await page.evaluate(() => sessionStorage.getItem('ontario_active_user_id')), null,
    'A cold session must not infer a teacher from a remembered profile');
  await teacher.click();
  await page.getByTestId('teacher-selector-modal').waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => localStorage.getItem('ota.last-confirmed-teacher.v1')), teacherId);
  await page.reload();
  await page.getByTestId('header-teacher-btn').waitFor();
  assert.equal(await page.getByTestId('teacher-selector-modal').count(), 0, 'Reload keeps the explicitly selected session');
  const nextSession = await page.context().newPage();
  try {
    await nextSession.goto(origin);
    await nextSession.getByTestId('teacher-selector-modal').waitFor();
    assert.equal(await nextSession.evaluate(() => sessionStorage.getItem('ontario_active_user_id')), null);
    const recent = nextSession.getByTestId(`select-teacher-${teacherId}`);
    assert.match(await recent.innerText(), /Last confirmed on this device[\s\S]*Continue/);
    await recent.click();
    await nextSession.getByTestId('teacher-selector-modal').waitFor({ state: 'hidden' });
    assert.equal(await nextSession.evaluate(() => sessionStorage.getItem('ontario_active_user_id')), teacherId);
  } finally { await nextSession.close(); }
}

try {
  const tasks: [string, (page: Page) => Promise<void>][] = [
    ['teacher-confirmation', teacherConfirmation],
    ['assessment-units-summary-order', runUiAssessmentAcceptance],
    ['photo-crop-roster-preservation', runUiPhotoRosterAcceptance],
    ['participation-scale-settings', runUiSettingsAcceptance],
  ];
  for (const [name, run] of tasks) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
    const external: string[] = [], errors: string[] = [];
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
    await context.route('**/*', route => {
      const url = route.request().url();
      if (new URL(url).origin !== origin) { external.push(url); return route.abort(); }
      return route.continue();
    });
    const page = await context.newPage();
    try {
      await page.goto(origin);
      if (name !== 'teacher-confirmation') {
        await page.locator('[data-testid^="select-teacher-"]').first().click();
        await page.getByTestId('teacher-selector-modal').waitFor({ state: 'hidden' });
      }
      await run(page);
      assert.deepEqual(errors, [], `${name}: no app exceptions`);
      assert.deepEqual(external, [], `${name}: no external app requests`);
      await page.screenshot({ path: `${directory}/${name}.png`, fullPage: true });
      completed.push(name);
      console.log(`PASS UI ${engine.name()}: ${name}`);
    } catch (error) {
      await page.screenshot({ path: `${directory}/${name}-failed.png`, fullPage: true }).catch(() => {});
      writeFileSync(`${directory}/${name}-failure.json`, JSON.stringify({ error: String(error), errors, external, body: await page.locator('body').innerText().catch(() => '') }, null, 2));
      failures.push({ task: name, error: String(error) });
      console.error(`FAIL UI ${engine.name()}: ${name}`, error);
    } finally { await context.close(); }
  }
  writeFileSync(`${directory}/results.json`, JSON.stringify({ engine: engine.name(), completed, failures, source: process.env.VITE_BUILD_SHA || 'local', limitations: ['fictional browser evidence', 'no native/device/OS-dialog acceptance', 'fresh sessions still require explicit teacher confirmation'] }, null, 2));
  if (failures.length) throw new Error(`UI acceptance failed: ${JSON.stringify(failures)}`);
} finally {
  await browser.close();
  await new Promise<void>(resolve => server.httpServer!.close(() => resolve()));
}
