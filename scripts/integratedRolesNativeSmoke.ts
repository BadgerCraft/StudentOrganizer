import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';
const executablePath = process.argv[2];
if (!executablePath) throw new Error('Provide the packaged Student Organizer executable.');
const profile = await mkdtemp(path.join(tmpdir(), 'so-roles-native-'));
let app;
try {
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], timeout: 60000 });
  let page = await app.firstWindow();
  // Seed the prior file entry in the same disposable native profile. This
  // checks storage-origin continuity, not an old binary/schema migration.
  const seedWindow = app.waitForEvent('window');
  await app.evaluate(async ({ app, BrowserWindow }) => {
    const path = (process as any).getBuiltinModule('path');
    const seed = new BrowserWindow({ show: false, webPreferences: { session: BrowserWindow.getAllWindows()[0].webContents.session, nodeIntegration: false, contextIsolation: true, sandbox: true } });
    await seed.loadFile(path.join(app.getAppPath(), 'dist/index.html'));
  });
  page = await seedWindow;
  await page.waitForURL('file://**/index.html');
  await page.getByRole('heading', { name: 'Enter Teacher here', exact: true }).waitFor();
  await page.getByLabel('Teacher name', { exact: true }).fill('Legacy Entry Fictional');
  await page.getByRole('button', { name: 'Save and use teacher', exact: true }).click();
  await page.getByTestId('teacher-selector-modal').waitFor({ state: 'hidden' });
  await page.evaluate(() => localStorage.setItem('student-organizer-appearance', 'light'));
  await app.close();
  app = await electron.launch({ executablePath, args: [`--user-data-dir=${profile}`], timeout: 60000 });
  page = await app.firstWindow();
  await page.getByRole('heading', { name: 'Choose your role' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Student Currently unavailable' }).isDisabled(), true);
  await page.getByRole('button', { name: 'Administrator Open Control Panel' }).click();
  await page.getByRole('heading', { name: 'Control Panel', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Import candidate + verify installer' }).isEnabled(), true);
  const status = await page.evaluate(async () => (window as any).ownerConsole.status());
  assert.equal(status.publicationReady, false);
  // Real packaged bridge / owning frame; deliberately canceled native picker fixture.
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
  await page.getByRole('button', { name: 'Import candidate + verify installer' }).click();
  await page.getByText('Import cancelled.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Choose another role' }).click();
  await page.getByRole('button', { name: 'Teacher Open your classroom workspace' }).click();
  await page.getByRole('heading', { name: 'Confirm teacher for this session', exact: true }).waitFor();
  await page.locator('[data-testid^="select-teacher-"]').filter({ hasText: 'Legacy Entry Fictional' }).click();
  await page.getByTestId('teacher-selector-modal').waitFor({ state: 'hidden' });
  assert.match(await page.getByTestId('header-teacher-btn').innerText(), /Legacy Entry Fictional/);
  assert.equal(await page.evaluate(() => localStorage.getItem('student-organizer-appearance')), 'light');
  assert.equal((await app.windows()).length, 1);
  console.log('PASS: actual packaged role entry and shared Control Panel bridge, canceled native action, same-window Teacher entry. No release or installer execution.');
} finally { await app?.close(); await rm(profile, { recursive: true, force: true }); }
