import { createServer } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Real profile component + services in a fresh Chromium database. The virtual entry is
// test-only: it creates a fictional first teacher/class/roster via production services.
const root = fileURLToPath(new URL('..', import.meta.url));
const cache = await mkdtemp(join(tmpdir(), 'qa-profile-'));
const port = Number(process.env.QA_CUSTOM_PORT || 4271), origin = `http://127.0.0.1:${port}`;
const entry = `
import React from 'react'; import { createRoot } from 'react-dom/client';
import { StudentProfileModal } from '/src/components/StudentProfileModal.tsx';
import { db } from '/src/db/database.ts';
import { initializeDatabase } from '/src/db/seeds.ts';
import { createTeacherProfile } from '/src/services/teacherProfileService.ts';
import { selectActingTeacher, getIdentityEpoch } from '/src/services/identityService.ts';
import { ClassDomainService } from '/src/services/classService.ts';
import { PortabilityService } from '/src/services/portabilityService.ts';
import { ProfileAssessmentService } from '/src/services/profileAssessmentService.ts';
await initializeDatabase(db);
const teacher = await createTeacherProfile(db, { name: 'Fictional QA Teacher' });
const actor = await selectActingTeacher(db, teacher.id);
const section = await new ClassDomainService(db).createClassSection({ ...actor, courseCode: 'QA1', courseTitle: 'Fictional QA', sectionNumber: '1', period: '1', roomNumber: '1', colorToken: '#ffffff' });
const portability = new PortabilityService(db);
const rows = await portability.validateRosterCandidates(section.id, [{ rowNumber: 1, rawText: 'Fictional Student 001', firstName: 'Fictional', lastName: 'Student', studentNumber: '001', error: null, warning: null }]);
await portability.importRosterBatch({ ...actor, classSectionId: section.id, rows });
const enrollment = await db.classEnrollments.where('classSectionId').equals(section.id).first();
const student = await db.students.get(enrollment.studentId), policy = await db.gradingPolicies.where('classSectionId').equals(section.id).first();
const reactRoot = createRoot(document.getElementById('root'));
async function render() {
 const props = { enrollmentId: enrollment.id, enrollment, student, policy, ...actor, onClose() { window.qaCloseCount = (window.qaCloseCount || 0) + 1; }, onOpenSettings() { window.qaSettingsCount = (window.qaSettingsCount || 0) + 1; }, onRefresh: render };
 const tables = { assessments: 'assessments', categories: 'assessmentCategories', studentAssessments: 'studentAssessments', categoryResults: 'categoryResults', participationEvents: 'participationEvents', overrides: 'gradeOverrides', notes: 'studentNotes', auditEntries: 'auditEntries' };
 for (const [key, table] of Object.entries(tables)) props[key] = await db.table(table).toArray();
 reactRoot.render(React.createElement(StudentProfileModal, props));
}
window.qaProfile = {
 delayNext(method) { const original = ProfileAssessmentService.prototype[method]; ProfileAssessmentService.prototype[method] = async function(input) { ProfileAssessmentService.prototype[method] = original; await new Promise(resolve => window.qaReleaseSave = resolve); return original.call(this, input); }; },
 async changePeriod() { const period = await db.reportingPeriods.get('local-reporting-period'); await db.reportingPeriods.add({ ...period, id: 'next-period', name: 'Next period', sequenceNumber: 2 }); await db.reportingPeriods.update(period.id, { isClosed: true }); },
 async state() { return { assessments: await db.assessments.toArray(), assignments: await db.studentAssessments.toArray(), results: await db.categoryResults.toArray(), overrides: await db.gradeOverrides.toArray() }; },
 async newerOverride() { const expected = await db.gradeOverrides.toCollection().first(); await new ProfileAssessmentService(db).saveOverride({ ...actor, identityEpoch: getIdentityEpoch(), enrollmentId: enrollment.id, classSectionId: section.id, policyId: policy.id, reportingPeriodId: 'local-reporting-period', categoryCode: 'OVERALL', overridePercentage: 95, rationale: 'Newer fictional judgment', expected }); await render(); },
 async readonly() { const staff = await db.classSectionStaff.where('classSectionId').equals(section.id).first(); await db.classSectionStaff.update(staff.id, { role: 'read_only' }); },
 async backup() { const before = await this.state(); await portability.restoreFromJSON(await portability.createFullBackupJSON()); return JSON.stringify(before) === JSON.stringify(await this.state()); }
};
await render();
`;
const server = await createServer({ root, cacheDir: cache, plugins: [{ name: 'qa-profile-entry',
  resolveId(id) { if (id === '/qa-profile-entry.ts') return id; },
  load(id) { if (id === '/qa-profile-entry.ts') return entry; },
  configureServer(vite) { vite.middlewares.use((req, res, next) => {
    if (req.url !== '/qa-profile.html') return next();
    res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><body><div id="root"></div><script type="module" src="/qa-profile-entry.ts"></script></body></html>');
  }); }
}], server: { host: '127.0.0.1', port, strictPort: true, watch: null, hmr: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium', headless: true });
try {
  const page = await browser.newPage(); page.setDefaultTimeout(15000);
  const errors: string[] = [], external: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  page.on('dialog', dialog => void dialog.accept());
  await page.goto(`${origin}/qa-profile.html`);
  await page.getByTestId('profile-tab-assessments').click();
  await page.getByTestId('profile-add-assignment-btn').click();
  await page.getByTestId('custom-assessment-period-select').selectOption('local-reporting-period');
  await page.getByTestId('custom-assessment-title-input').fill('Fictional atomic work');
  assert.match(await page.getByTestId('custom-assessment-score-input').getAttribute('placeholder') || '', /88/);
  await page.getByTestId('custom-assessment-score-input').fill('4+');
  await page.getByTestId('save-custom-assessment-btn').click();
  await page.getByText('Invalid percentage format', { exact: false }).waitFor();
  const state = () => page.evaluate('window.qaProfile.state()') as Promise<{ assessments: { reportingPeriodId: string }[]; assignments: unknown[]; results: { normalizedPercentage: number }[]; overrides: { overridePercentage: number }[] }>;
  assert.equal((await state()).assessments.length, 0);
  await page.getByTestId('custom-assessment-score-input').fill('88%');
  await page.evaluate("window.qaProfile.delayNext('createIndividual')");
  await page.getByTestId('custom-assessment-form').evaluate((form: HTMLFormElement) => { form.requestSubmit(); form.requestSubmit(); });
  await page.waitForFunction(() => !!(window as any).qaReleaseSave);
  for (const id of ['custom-assessment-title-input', 'custom-assessment-score-input', 'custom-assessment-feedback-input', 'custom-assessment-period-select', 'cancel-custom-assessment-btn', 'profile-close-btn', 'profile-settings-gear-btn']) assert.equal(await page.getByTestId(id).isDisabled(), true);
  await page.keyboard.press('Escape'); assert.equal(await page.evaluate('window.qaCloseCount || 0'), 0);
  assert.equal(await page.getByTestId('custom-assessment-form').isVisible(), true);
  await page.evaluate('window.qaReleaseSave(); delete window.qaReleaseSave');
  await page.getByTestId('custom-assessment-form').waitFor({ state: 'hidden' });
  const saved = await state(); assert.equal(saved.assessments.length, 1); assert.equal(saved.assignments.length, 1); assert.equal(saved.results.length, 1); assert.equal(saved.results[0].normalizedPercentage, 88); assert.equal(saved.assessments[0].reportingPeriodId, 'local-reporting-period');
  await page.getByTestId('open-grade-override-btn').click();
  await page.getByTestId('override-percentage-input').fill('91'); await page.getByTestId('override-rationale-input').fill('Fictional judgment');
  await page.evaluate("window.qaProfile.delayNext('saveOverride')");
  await page.getByTestId('save-override-btn').click();
  await page.waitForFunction(() => !!(window as any).qaReleaseSave);
  for (const id of ['override-percentage-input', 'override-rationale-input', 'override-period-select', 'cancel-override-btn']) assert.equal(await page.getByTestId(id).isDisabled(), true);
  await page.keyboard.press('Escape'); assert.equal(await page.getByTestId('override-modal').isVisible(), true);
  await page.evaluate('window.qaReleaseSave(); delete window.qaReleaseSave');
  await page.getByTestId('override-modal').waitFor({ state: 'hidden' });
  await page.getByTestId('open-grade-override-btn').click();
  assert.equal(await page.getByTestId('override-percentage-input').inputValue(), '91');
  await page.getByTestId('override-percentage-input').fill('92');
  await page.evaluate('window.qaProfile.newerOverride()');
  await page.getByTestId('save-override-btn').click();
  await page.getByTestId('override-modal').getByRole('alert').filter({ hasText: 'This override changed since the form opened.' }).waitFor({ state: 'visible' });
  assert.equal(await page.getByTestId('override-percentage-input').inputValue(), '92');
  assert.equal((await state()).overrides[0].overridePercentage, 95);
  await page.getByTestId('cancel-override-btn').click();
  await page.getByTestId('profile-add-assignment-btn').click();
  await page.getByTestId('custom-assessment-title-input').fill('Fictional period race');
  await page.evaluate('window.qaProfile.changePeriod()');
  await page.getByTestId('custom-assessment-period-select').getByRole('option', { name: 'Next period' }).waitFor({ state: 'attached' });
  // The live-query option refresh must not silently replace the opening period.
  assert.notEqual(await page.getByTestId('custom-assessment-period-select').inputValue(), 'next-period');
  await page.getByTestId('custom-assessment-form').evaluate((form: HTMLFormElement) => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  await page.getByRole('alert').filter({ hasText: 'Choose an open reporting period' }).waitFor();
  assert.equal((await state()).assessments.length, 1);
  await page.getByTestId('custom-assessment-period-select').selectOption('next-period');
  await page.getByTestId('save-custom-assessment-btn').click();
  await page.getByTestId('custom-assessment-form').waitFor({ state: 'hidden' });
  assert.equal((await state()).assessments.length, 2);
  await page.evaluate('window.qaProfile.readonly()');
  await page.getByTestId('profile-add-assignment-btn').click();
  await page.getByTestId('custom-assessment-title-input').fill('Fictional denied work');
  await page.getByTestId('custom-assessment-period-select').selectOption('next-period');
  await page.getByTestId('save-custom-assessment-btn').click();
  await page.getByText('Read-only', { exact: false }).waitFor({ state: 'attached' }).catch(async () => {
    // The domain may phrase a read-only staff denial as absence of write access.
    await page.waitForFunction(() => document.body.textContent?.includes('permission') || document.body.textContent?.includes('write access'));
  });
  assert.equal((await state()).assessments.length, 2);
  assert.equal(await page.evaluate('window.qaProfile.backup()'), true);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  console.log('PASS: real profile fresh calendar, invalid-score rollback, corrected double-submit once, pending edits/dismissal guards, override visible conflict, explicit period-change recovery, read-only blank-score rejection, full backup roundtrip. Fictional browser data only.');
} finally { await browser.close(); await server.close(); await rm(cache, { recursive: true, force: true }); }
