import { openRecovery, showClassTools } from './helpers/organizerNavigation';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { preview } from 'vite';
import { chromium, type Page } from 'playwright';
import { buildTorontoTimestamp } from '../src/utils/dateUtils';
import { installFictionalClassroom } from './helpers/classroomFixture';

const origin = 'http://127.0.0.1:4214';
const completed: string[] = [];
const server = await preview({ preview: { host: '127.0.0.1', port: 4214, strictPort: true } });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium' });
async function rows(page: Page, table: string): Promise<any[]> {
  return page.evaluate(table => new Promise((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result, tx = database.transaction(table, 'readonly');
      const read = tx.objectStore(table).getAll();
      read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error);
      tx.oncomplete = () => database.close();
    };
  }), table);
}
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    if (route.request().url().startsWith(`${origin}/`)) return route.continue();
    external.push(route.request().url()); return route.abort();
  });
  await page.goto(origin); await installFictionalClassroom(page);
  // Extend only this fresh fictional fixture with a level observation button.
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onsuccess = () => {
      const database = request.result, tx = database.transaction('participationEventTypes', 'readwrite');
      const store = tx.objectStore('participationEventTypes'), read = store.getAll();
      read.onsuccess = () => store.add({ ...read.result[0], id: 'fictional-level-observation', code: 'FICTIONAL_LEVEL', name: 'Fictional level observation', recordingMode: 'level_1_4', defaultPoints: 0 });
      tx.oncomplete = () => { database.close(); resolve(); }; tx.onabort = () => reject(tx.error);
    }; request.onerror = () => reject(request.error);
  }));
  await page.reload();
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await page.getByTestId('nav-dashboard-btn').click();
  await page.getByTestId('chiclet-open-overlay-btn').first().click();
  await showClassTools(page);
  const cards = page.getByTestId('student-seat-card');
  const selected = page.locator('[data-testid="student-seat-card"][aria-pressed="true"]');
  const single = page.getByRole('button', { name: 'Single student', exact: true });
  const group = page.getByRole('button', { name: 'Group', exact: true });
  const choose = async (index: number) => { await cards.nth(index).getByTestId('student-seat-name').click(); };
  const expectCount = async (count: number) => { await page.waitForFunction(count => document.querySelectorAll('[data-testid="student-seat-card"][aria-pressed="true"]').length === count, count); };
  const baseline = await rows(page, 'participationEvents');
  const formalTables = ['categoryResults', 'studentAssessments', 'gradeOverrides'];
  const formal = Object.fromEntries(await Promise.all(formalTables.map(async table => [table, await rows(page, table)])));
  assert.equal(await single.getAttribute('aria-pressed'), 'true');
  await choose(0); await choose(1); await expectCount(1);
  assert.equal(await cards.nth(0).getAttribute('aria-pressed'), 'false');
  await group.click(); await expectCount(1); await choose(0); await expectCount(2);
  await choose(0); await expectCount(1); await choose(0);
  await single.click(); await expectCount(0);
  await choose(0); await page.getByTestId('toggle-note-btn').click();
  await page.getByTestId('observation-note-input').fill('Fictional draft for first student only');
  // Changing target must acknowledge meaningful entered work, not merely erase stale state.
  let prompted = false;
  const cancelDraftChange = async (action: () => Promise<unknown>) => {
    prompted = false;
    page.once('dialog', async dialog => {
      prompted = true; assert.match(dialog.message(), /discard unsaved participation/i); await dialog.dismiss();
    });
    await action();
    assert.equal(prompted, true, 'Draft-changing action must request acknowledgment');
    assert.equal(await page.getByTestId('observation-note-input').inputValue(), 'Fictional draft for first student only');
    assert.equal(await cards.nth(0).getAttribute('aria-pressed'), 'true');
    assert.deepEqual(await rows(page, 'participationEvents'), baseline);
  };
  await cancelDraftChange(() => choose(1));
  await cancelDraftChange(() => choose(0)); // Deselecting the current target also loses the draft.
  await cancelDraftChange(() => group.click());
  const draftClass = await page.getByTestId('header-class-select').inputValue();
  const draftDate = await page.getByTestId('school-date-picker').inputValue();
  const alternateClass = await page.getByTestId('header-class-select').locator('option').evaluateAll((options, initial) => options.map(option => (option as HTMLOptionElement).value).find(value => value && value !== initial), draftClass);
  assert.ok(alternateClass);
  await cancelDraftChange(() => page.getByTestId('header-class-select').selectOption(alternateClass));
  assert.equal(await page.getByTestId('header-class-select').inputValue(), draftClass);
  await cancelDraftChange(() => page.getByTestId('prev-day-btn').click());
  assert.equal(await page.getByTestId('school-date-picker').inputValue(), draftDate);
  await cancelDraftChange(() => page.getByRole('button', { name: 'List View (Markbook)', exact: true }).click());
  await cancelDraftChange(() => page.getByTestId('header-teacher-btn').click());
  assert.equal(await page.getByTestId('teacher-selector-modal').count(), 0);
  await cancelDraftChange(() => page.getByRole('button', { name: 'Close dock', exact: true }).click());
  await cancelDraftChange(() => page.getByRole('button', { name: 'Report a problem', exact: true }).click());
  assert.equal(await page.getByTestId('bug-report-modal').count(), 0);
  await cancelDraftChange(() => cards.first().getByTestId('open-student-profile-btn').click());
  await cancelDraftChange(() => cards.first().getByTestId('student-settings-gear-btn').click());
  assert.equal(await single.getAttribute('aria-pressed'), 'true');
  page.once('dialog', dialog => dialog.accept());
  await choose(1); assert.equal(await page.getByTestId('observation-note-input').count(), 0);
  const eventTypes = await rows(page, 'participationEventTypes');
  const levelType = eventTypes.find(type => type.recordingMode === 'level_1_4' && !type.isArchived);
  assert.ok(levelType);
  const levelButton = () => page.getByRole('button', { name: `Record ${levelType.name}`, exact: true });
  await levelButton().click(); await page.getByTestId('cancel-level-btn').click();
  assert.deepEqual(await rows(page, 'participationEvents'), baseline);
  await levelButton().click();
  let levelPrompted = false;
  page.once('dialog', async dialog => { levelPrompted = true; await dialog.dismiss(); });
  await group.click();
  assert.equal(levelPrompted, true, 'Pending level choice alone requires acknowledgment');
  assert.equal(await page.getByTestId('level-selector-tray').count(), 1);
  assert.equal(await single.getAttribute('aria-pressed'), 'true');
  page.once('dialog', dialog => dialog.accept());
  await choose(0);
  assert.equal(await page.getByTestId('level-selector-tray').count(), 0);
  await levelButton().click(); await page.keyboard.press('Escape');
  assert.equal(await page.getByTestId('level-selector-tray').count(), 0);
  await page.getByRole('button', { name: 'Close dock', exact: true }).click();
  await expectCount(0); assert.equal(await single.getAttribute('aria-pressed'), 'true');
  completed.push('Single replaces target; explicit Group retains/adds/removes; Single clears group; target changes reset note/level only after explicit discard; Cancel/Escape/Close without edits write nothing.');

  // Both mode directions protect notes; acknowledged changes clear the old draft.
  await choose(0); await page.getByTestId('toggle-note-btn').click();
  await page.getByTestId('observation-note-input').fill('Fictional draft for first student only');
  page.once('dialog', dialog => dialog.accept()); await group.click();
  assert.equal(await page.getByTestId('observation-note-input').count(), 0);
  await page.getByTestId('toggle-note-btn').click();
  await page.getByTestId('observation-note-input').fill('Fictional draft for first student only');
  await cancelDraftChange(() => single.click());
  assert.equal(await group.getAttribute('aria-pressed'), 'true');
  page.once('dialog', dialog => dialog.accept()); await single.click(); await expectCount(0);
  // Explicitly acknowledged date, class, view and teacher departures clear old drafts.
  for (const departure of ['day', 'class', 'view', 'teacher'] as const) {
    await choose(0); await page.getByTestId('toggle-note-btn').click();
    await page.getByTestId('observation-note-input').fill('Fictional draft for first student only');
    page.once('dialog', dialog => dialog.accept());
    if (departure === 'day') {
      await page.getByTestId('prev-day-btn').click(); await page.getByTestId('today-btn').click();
    } else if (departure === 'class') {
      await page.getByTestId('header-class-select').selectOption(alternateClass);
      await page.getByTestId('header-class-select').selectOption(draftClass);
    } else if (departure === 'view') {
      await page.getByRole('button', { name: 'List View (Markbook)', exact: true }).click();
      await page.getByRole('button', { name: 'Class View', exact: true }).click();
    } else {
      await page.getByTestId('header-teacher-btn').click();
      await page.getByTestId('teacher-selector-modal').waitFor(); await page.keyboard.press('Escape');
      await page.getByTestId('teacher-selector-modal').waitFor({ state: 'hidden' });
    }
    await expectCount(0); assert.equal(await single.getAttribute('aria-pressed'), 'true');
    await choose(0); assert.equal(await page.getByTestId('observation-note-input').count(), 0);
    await page.getByRole('button', { name: 'Close dock', exact: true }).click();
  }
  assert.deepEqual(await rows(page, 'participationEvents'), baseline);
  await choose(0);
  const categoryOnly = page.locator('.participation-dock').getByTitle('Force no category');
  await categoryOnly.click(); const chosenCategoryStyle = await categoryOnly.getAttribute('class');
  let categoryPrompted = false;
  page.once('dialog', async dialog => { categoryPrompted = true; await dialog.dismiss(); });
  await choose(1);
  assert.equal(categoryPrompted, true, 'A category-only edit requires acknowledgment');
  assert.equal(await categoryOnly.getAttribute('class'), chosenCategoryStyle);
  assert.equal(await cards.nth(0).getAttribute('aria-pressed'), 'true');
  await page.locator('.participation-dock').getByTitle("Use button's default category").click();
  await page.getByRole('button', { name: 'Close dock', exact: true }).click();
  completed.push('Unsaved note: Cancel preserves exact text/target on student, deselect, mode, class, day, view, teacher, Close and overlay actions; accepted mode/context changes discard deliberately with zero writes. Pending level and category-only edits are also guarded.');

  await choose(0); await group.click(); await choose(1);
  await page.getByTestId('prev-day-btn').click(); await expectCount(0);
  assert.equal(await single.getAttribute('aria-pressed'), 'true');
  const schoolDate = await page.getByTestId('school-date-picker').inputValue();
  await choose(0); await group.click(); await choose(1);
  await page.getByTestId('historical-time-input').fill('10:30');
  await page.getByTestId('toggle-note-btn').click();
  await page.getByTestId('observation-note-input').fill('Fictional intentional historical group');
  await levelButton().click(); await page.getByTestId('level-3-btn').click();
  await page.getByTestId('undo-toast-btn').waitFor(); await expectCount(0);
  const saved = (await rows(page, 'participationEvents')).filter(row => !baseline.some(old => old.id === row.id));
  assert.equal(saved.length, 2); assert.equal(saved[0].batchId, saved[1].batchId);
  for (const row of saved) {
    assert.equal(row.localSchoolDate, schoolDate); assert.equal(row.achievementLevel, 3);
    assert.equal(row.note, 'Fictional intentional historical group');
    assert.equal(row.classSessionId, saved[0].classSessionId);
    assert.equal(row.occurredAt, buildTorontoTimestamp(schoolDate, '10:30'));
  }
  assert.equal((await rows(page, 'classSessions')).find(row => row.id === saved[0].classSessionId).localSchoolDate, schoolDate);
  await page.getByTestId('undo-toast-btn').click();
  await page.getByTestId('undo-toast-btn').waitFor({ state: 'hidden' });
  assert.ok((await rows(page, 'participationEvents')).filter(row => saved.some(old => old.id === row.id)).every(row => row.deletedAt));
  assert.deepEqual((await rows(page, 'participationEvents')).filter(row => baseline.some(old => old.id === row.id)), baseline);
  for (const table of formalTables) assert.deepEqual(await rows(page, table), formal[table]);
  completed.push('Historical two-student level event persisted one batch/session/date/time/note; Undo retracts both; historical events and formal result tables unchanged.');

  await page.getByTestId('today-btn').click();
  await choose(0); await choose(1);
  await page.getByRole('button', { name: 'Record Contributed an idea', exact: true }).click();
  await page.getByTestId('undo-toast-btn').waitFor();
  const singleSaved = (await rows(page, 'participationEvents')).filter(row => !baseline.some(old => old.id === row.id) && !saved.some(old => old.id === row.id));
  assert.equal(singleSaved.length, 1);
  await page.getByRole('button', { name: 'List View (Markbook)', exact: true }).click();
  await page.getByRole('button', { name: 'Class View', exact: true }).click();
  await page.getByTestId('undo-toast-btn').click();
  await page.getByTestId('undo-toast-btn').waitFor({ state: 'hidden' });
  assert.ok((await rows(page, 'participationEvents')).find(row => row.id === singleSaved[0].id).deletedAt);
  completed.push('Default single quick tally writes exactly one event; Undo remains available after leaving and returning to Class View.');
  await choose(0); await group.click(); await choose(1);
  await page.getByRole('button', { name: 'List View (Markbook)', exact: true }).click();
  await page.getByRole('button', { name: 'Class View', exact: true }).click();
  await expectCount(0); assert.equal(await single.getAttribute('aria-pressed'), 'true');
  await choose(0); await group.click();
  const classSelect = page.getByTestId('header-class-select');
  const initialClass = await classSelect.inputValue();
  const otherClass = await classSelect.locator('option').evaluateAll((options, initial) => options.map(option => (option as HTMLOptionElement).value).find(value => value && value !== initial), initialClass);
  assert.ok(otherClass); await classSelect.selectOption(otherClass); await classSelect.selectOption(initialClass);
  await expectCount(0); assert.equal(await single.getAttribute('aria-pressed'), 'true');
  await choose(0); await group.click();
  await page.getByTestId('header-teacher-btn').click();
  await page.getByTestId('teacher-selector-modal').waitFor();
  assert.equal(await page.locator('.participation-dock').count(), 0);
  assert.equal(await page.locator('#app-workspace').getAttribute('inert'), '');
  await page.keyboard.press('Escape');
  await page.getByTestId('teacher-selector-modal').waitFor({ state: 'hidden' });
  await expectCount(0); assert.equal(await single.getAttribute('aria-pressed'), 'true');
  await choose(0); await group.click();
  await showClassTools(page);
  await cards.first().getByTestId('open-student-profile-btn').click();
  await page.getByTestId('profile-close-btn').waitFor();
  assert.equal(await page.locator('.participation-dock').count(), 0);
  // Real pointer click outside the profile must not select a classroom target.
  await page.mouse.click(5, 500); await expectCount(0);
  if (await page.getByTestId('profile-close-btn').count()) await page.getByTestId('profile-close-btn').click();
  await choose(0);
  const dock = await page.locator('.participation-dock').boundingBox(); assert.ok(dock);
  const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.participation-dock') !== null, { x: dock.x + 5, y: dock.y + 5 });
  assert.equal(hit, true, 'Dock outer padding intercepts background clicks');
  await page.mouse.click(dock.x + 5, dock.y + 5); await expectCount(1);
  await page.getByRole('button', { name: 'Close dock', exact: true }).click();
  await choose(0);
  await page.getByRole('button', { name: 'Report a problem', exact: true }).click();
  await page.getByTestId('bug-report-modal').waitFor();
  assert.equal(await page.locator('.participation-dock').count(), 0, 'Bug-report overlay must hide participation controls');
  const beforeReportClick = await rows(page, 'participationEvents');
  await page.mouse.click(5, 900);
  assert.deepEqual(await rows(page, 'participationEvents'), beforeReportClick);
  await page.keyboard.press('Escape');
  await page.getByTestId('bug-report-modal').waitFor({ state: 'hidden' });
  await group.click(); await choose(1); await expectCount(2);
  await page.getByTestId('header-teacher-btn').click();
  await page.getByRole('button', { name: 'Add another teacher', exact: true }).click();
  await page.getByLabel('Teacher name', { exact: true }).fill('Fictional Participation Teacher');
  await page.getByRole('button', { name: 'Save and use teacher', exact: true }).click();
  await page.getByTestId('teacher-selector-modal').waitFor({ state: 'hidden' });
  assert.equal(await selected.count(), 0);
  assert.equal(await page.getByTestId('participation-event-btn').count(), 0);
  for (const table of formalTables) assert.deepEqual(await rows(page, table), formal[table]);
  completed.push('View/class/day/teacher cancel and actual teacher switch reset selection; profile/teacher overlays and dock padding prevent background activation.');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await writeFile('/tmp/participation-selection-results.json', JSON.stringify({ status: 'pass', completed, errors, external, nativeDesktopVerified: false }, null, 2));
  console.log(completed.join('\nPASS: '));
} catch (error) {
  await writeFile('/tmp/participation-selection-results.json', JSON.stringify({ status: 'fail', completed, failure: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); await new Promise<void>(resolve => server.httpServer!.close(() => resolve())); }
