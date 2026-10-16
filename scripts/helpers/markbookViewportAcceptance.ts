import assert from 'node:assert/strict';
import type { Page } from 'playwright';

/** Existing fictional assessment only; classroom writes go through the visible UI. */
export async function verifyCompactMarkbookEditor(page: Page, enrollmentId: string, categoryId: string) {
  const previousViewport = page.viewportSize();
  const cell = page.getByTestId(`markbook-cell-${enrollmentId}-${categoryId}`);
  const form = page.locator('form').filter({ has: page.getByRole('button', { name: 'Save Result', exact: true }) });
  const feedback = 'Fictional compact-window feedback';
  const result = () => page.evaluate(({ category, enrollment }) => new Promise<any>((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(['categoryResults', 'studentAssessments'], 'readonly');
      const assessments = transaction.objectStore('studentAssessments').getAll();
      const read = transaction.objectStore('categoryResults').getAll();
      read.onsuccess = () => resolve(read.result.find(row => row.assessmentCategoryId === category && row.deletedAt === null
        && assessments.result.some(studentAssessment => studentAssessment.id === row.studentAssessmentId && studentAssessment.classEnrollmentId === enrollment)));
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => database.close();
    };
  }), { category: categoryId, enrollment: enrollmentId });
  try {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.getByRole('button', { name: 'List View (Markbook)', exact: true }).click();
    await cell.click();
    const levels = form.getByRole('group', { name: 'Assigned K level', exact: true });
    await levels.getByRole('button', { name: '3+', exact: true }).click();
    await form.getByPlaceholder('Optional constructive feedback for this category...').fill(feedback);
    await form.getByRole('button', { name: 'Complete', exact: true }).click();
    const save = form.getByRole('button', { name: 'Save Result', exact: true });
    // Trial uses the same visibility/scroll checks as a normal click, with no
    // forced interaction or changes to the page's styles or zoom.
    await save.click({ trial: true });
    const geometry = await form.evaluate(form => {
      const panel = form.parentElement!, box = panel.getBoundingClientRect();
      const buttons = Array.from(form.querySelectorAll('button')).filter(button => ['Save Result', 'Cancel'].includes(button.textContent?.trim() ?? ''));
      return { panelTop: box.top, panelBottom: box.bottom, viewportHeight: innerHeight, scrollTop: panel.scrollTop,
        buttons: buttons.map(button => { const rect = button.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; }) };
    });
    assert.ok(geometry.panelTop >= 0 && geometry.panelBottom <= geometry.viewportHeight, 'Result editor panel must fit the compact window');
    assert.ok(geometry.buttons.every(button => button.top >= 0 && button.bottom <= geometry.viewportHeight), 'Save and Cancel must be reachable inside the compact window');
    await save.click();
    await form.waitFor({ state: 'hidden' });
    await cell.filter({ hasText: '3+' }).waitFor();
    const saved = await result();
    assert.equal(saved?.rawScore, '3+');
    assert.equal(saved.inputFormat, 'classroom_level');
    assert.equal(saved.normalizedPercentage, 78);
    assert.equal(saved.feedback, feedback);
    await cell.click();
    assert.equal(await levels.getByRole('button', { name: '3+', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await form.getByPlaceholder('Optional constructive feedback for this category...').inputValue(), feedback);
    await levels.getByRole('button', { name: '2', exact: true }).click();
    await form.getByPlaceholder('Optional constructive feedback for this category...').fill('Fictional unsaved change');
    await form.getByRole('button', { name: 'Cancel', exact: true }).click();
    await form.waitFor({ state: 'hidden' });
    assert.deepEqual(await result(), saved, 'Cancel must preserve the saved level and feedback');
    return geometry;
  } finally {
    if (previousViewport) await page.setViewportSize(previousViewport);
  }
}
