import type { Page } from 'playwright';

/** Fictional acceptance helper: use the same rubric-first entry as a teacher. */
export async function openUnifiedMarking(page: Page, options: { phone?: boolean; rubricId?: string } = {}) {
  const back = page.getByRole('button', { name: 'Back to Organizer', exact: true });
  if (await back.isVisible()) await back.click();
  await page.getByRole('button', { name: 'Assessments', exact: true }).click();
  const entry = page.locator('[data-testid^="open-marking-"]').first();
  const assessmentId = (await entry.getAttribute('data-testid'))!.slice('open-marking-'.length);
  const rubricId = options.rubricId ?? await page.evaluate(async assessmentId => {
    const d = '/src/db/database.ts', m = '/src/marking/markingService.ts', i = '/src/services/identityService.ts';
    const { db } = await import(d), identity = await import(i), userId = identity.getActiveTeacherId();
    const existing = await db.markingRubrics.where('assessmentId').equals(assessmentId).filter((r: any) => r.createdBy === userId && r.deletedAt === null).first();
    if (existing) return existing.id;
    const device = await db.devices.where('userId').equals(userId).first();
    return (await new (await import(m)).MarkingService(db).saveRubric(assessmentId, { title: 'Fictional unified capture rubric', levels: ['Clear'], criteria: [{ id: 'fictional-evidence', name: 'Evidence', categoryCode: 'K', descriptors: { Clear: 'Clear fictional evidence' } }] }, { userId, deviceId: device.id, epoch: identity.getIdentityEpoch() })).id;
  }, assessmentId);
  await entry.click(); await page.getByTestId('marking-mode-written').click();
  await page.getByLabel('Choose confirmed rubric', { exact: true }).selectOption(rubricId);
  await page.getByRole('button', { name: 'Continue with confirmed rubric', exact: true }).click();
  if (options.phone !== false) {
    const wizard = page.getByTestId('evidence-import-wizard');
    await wizard.getByLabel('Phone-photo ZIP', { exact: true }).check();
    await wizard.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.waitForFunction(() => document.querySelector<HTMLInputElement>('[data-testid="capture-zip"]')?.disabled === false);
  }
  return { assessmentId, rubricId };
}
