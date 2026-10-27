import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { installFictionalClassroom } from './helpers/classroomFixture';
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null, hmr: false } });
await server.listen(); const address = server.httpServer!.address(); assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); page.setDefaultTimeout(12000);
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : (external.push(route.request().url()), route.abort()));
  await page.goto(origin); await installFictionalClassroom(page); await page.locator('[data-testid^="select-teacher-"]').first().click();
  const cards = page.getByTestId('student-seat-card'), first = cards.first(); await first.waitFor();
  const snapshots = () => page.evaluate(async () => { const path = '/src/db/database.ts', { db } = await import(path);
    return Object.fromEntries(await Promise.all(['classSessions', 'participationEvents', 'participationDailySummaries', 'auditEntries', 'syncMutations'].map(async name => [name, await db.table(name).toArray()]))); });
  const record = async () => { await first.focus(); await page.keyboard.press('Space'); await page.getByTestId('participation-event-btn').filter({ hasNotText: '1–4 Level' }).first().click(); };
  const before = await snapshots(); await record(); await page.getByTestId('participation-event-btn').first().waitFor({ state: 'hidden' });
  const afterA = await snapshots(), eventA = afterA.participationEvents.find((row: any) => !before.participationEvents.some((old: any) => old.id === row.id)); assert.ok(eventA);
  async function installGate(method: 'recordParticipation' | 'retractEvent') {
    await page.evaluate(async method => { const path = '/src/services/participationService.ts', { ParticipationDomainService } = await import(path);
      const original = ParticipationDomainService.prototype[method];
      (window as any).participationGateEntered = false;
      ParticipationDomainService.prototype[method] = async function(...args: any[]) {
        const result = await original.apply(this, args); (window as any).participationGateEntered = true;
        await new Promise<void>(resolve => { (window as any).releaseParticipationGate = resolve; }); return result;
      };
      (window as any).restoreParticipationGate = () => { ParticipationDomainService.prototype[method] = original; };
    }, method);
  }
  async function tryContextChanges() {
    await page.waitForFunction(() => (window as any).participationGateEntered);
    const classId = await page.getByTestId('header-class-select').inputValue(), date = await page.getByTestId('school-date-picker').inputValue();
    await cards.nth(1).focus(); await page.keyboard.press('Space');
    assert.equal(await first.getAttribute('aria-pressed'), 'true'); assert.equal(await cards.nth(1).getAttribute('aria-pressed'), 'false');
    await page.getByTestId('header-teacher-btn').click(); assert.equal(await page.getByTestId('teacher-selector-modal').count(), 0);
    await page.getByTestId('nav-markbook-btn').click(); await first.waitFor();
    await page.getByTestId('prev-day-btn').click(); assert.equal(await page.getByTestId('school-date-picker').inputValue(), date);
    const alternative = await page.getByTestId('header-class-select').locator('option').evaluateAll((options, current) => options.map(option => (option as HTMLOptionElement).value).find(value => value !== current), classId);
    if (alternative) { await page.getByTestId('header-class-select').selectOption(alternative); assert.equal(await page.getByTestId('header-class-select').inputValue(), classId); }
    await first.focus(); await page.keyboard.press('Control+z');
    assert.equal((await snapshots()).participationEvents.find((row: any) => row.id === eventA.id).deletedAt, methodState === 'record' ? null : eventADeleted);
  }
  let methodState: 'record' | 'retract' = 'record', eventADeleted: string | null = null;
  await installGate('recordParticipation'); await record(); await tryContextChanges();
  const afterB = await snapshots(), eventB = afterB.participationEvents.find((row: any) => !afterA.participationEvents.some((old: any) => old.id === row.id)); assert.ok(eventB);
  await page.evaluate(() => { (window as any).restoreParticipationGate(); (window as any).releaseParticipationGate(); });
  await page.getByTestId('participation-event-btn').first().waitFor({ state: 'hidden' }); await first.focus(); await page.keyboard.press('Control+z');
  await page.waitForFunction(async id => { const path = '/src/db/database.ts'; return !!(await (await import(path)).db.participationEvents.get(id)).deletedAt; }, eventB.id);
  assert.equal((await snapshots()).participationEvents.find((row: any) => row.id === eventA.id).deletedAt, null, 'latest record undo never deletes earlier record');
  await first.focus(); await page.keyboard.press('Space'); await installGate('retractEvent'); methodState = 'retract';
  await page.locator(`[data-event-id="${eventA.id}"]`).click(); await page.waitForFunction(() => (window as any).participationGateEntered);
  eventADeleted = (await snapshots()).participationEvents.find((row: any) => row.id === eventA.id).deletedAt;
  await tryContextChanges(); await page.evaluate(() => { (window as any).restoreParticipationGate(); (window as any).releaseParticipationGate(); });
  await page.getByRole('status').filter({ hasText: 'Saving feedback' }).waitFor({ state: 'hidden' });
  await first.focus(); await page.keyboard.press('Control+z'); await page.locator(`[data-event-id="${eventA.id}"]`).waitFor();
  assert.equal((await snapshots()).participationEvents.find((row: any) => row.id === eventA.id).version, 3);
  // Simulate identity changing while getAppIdentity awaits its existing device read.
  const beforeStale = await snapshots();
  await page.evaluate(async () => { const databasePath = '/src/db/database.ts', identityPath = '/src/services/identityService.ts';
    const { db } = await import(databasePath), identity = await import(identityPath), original = db.devices.get.bind(db.devices);
    db.devices.get = async (...args: any[]) => { db.devices.get = original; const result = await original(...args); const user = identity.getActiveTeacherId(); identity.clearActiveTeacherId(); identity.setActiveTeacherId(user); return result; };
  });
  await page.getByTestId('participation-event-btn').filter({ hasNotText: '1–4 Level' }).first().click();
  await page.getByRole('alert').filter({ hasText: 'teacher, student or school day changed' }).waitFor();
  assert.deepEqual(await snapshots(), beforeStale, 'stale opening identity creates no session/event/projection/audit/outbox');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: delayed committed record/retraction blocks student/class/day/view/teacher changes and CtrlZ until settled; next CtrlZ targets actual latest action; identity change during prewrite resolution creates zero records.');
} finally { await browser.close(); await server.close(); }
