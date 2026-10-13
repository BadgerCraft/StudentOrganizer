import assert from 'node:assert/strict';
import type { Page } from 'playwright';

async function rows(page: Page, table: string): Promise<any[]> {
  return page.evaluate(table => new Promise<any[]>((resolve, reject) => {
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
async function untilRows(page: Page, table: string, matches: (records: any[]) => boolean) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await rows(page, table);
    if (matches(result)) return result;
    await page.waitForTimeout(100);
  }
  throw new Error(`Settings acceptance did not observe expected ${table} write`);
}
async function settings(page: Page) {
  await page.locator('button[title="Grading Policies & Scale Presets"]').click();
  await page.getByRole('heading', { name: 'Grading Policies & Observation Settings', exact: true }).waitFor();
  await page.getByTestId('mark-scale-entry').first().waitFor();
}
async function noOverflow(page: Page) {
  const width = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth }));
  assert.ok(width.page <= width.viewport + 1, `Settings overflow: ${JSON.stringify(width)}`);
}

/** Fresh disposable fictional context only. Actual UI writes; fixture setup is explicitly labelled. */
export async function runUiSettingsAcceptance(page: Page): Promise<void> {
  await page.getByTestId('chiclet-open-overlay-btn').first().click();
  await settings(page);
  const entries = await rows(page, 'markScaleEntries');
  const policies = await rows(page, 'gradingPolicies');
  const initialVersion = policies[0].defaultMarkScaleVersionId;
  const visible = entries.filter(entry => entry.markScaleVersionId === initialVersion);
  assert.equal(await page.getByTestId('mark-scale-entry').count(), visible.length);
  for (const entry of visible) {
    const cell = page.getByTestId('mark-scale-entry').filter({ has: page.getByText(entry.code, { exact: true }) });
    assert.equal(await cell.count(), 1);
    if (entry.isNumeric) assert.ok((await cell.innerText()).includes(`${entry.benchmarkPercentage}%`));
    else assert.ok((await cell.innerText()).includes('No numeric conversion'));
  }
  const initialTypes = await rows(page, 'participationEventTypes');
  const initialEvents = await rows(page, 'participationEvents');
  const formalResults = await rows(page, 'categoryResults');
  // Each classification has the same discoverable creation action, and its default matches the group.
  for (const classification of ['positive', 'neutral', 'needs_followup']) {
    const trigger = page.getByTestId(`create-${classification}-button`);
    assert.ok((await trigger.boundingBox())!.height >= 44);
    await trigger.click();
    assert.equal(await page.getByTestId('event-type-classification-select').inputValue(), classification);
    await page.getByTestId('event-type-name-input').fill(`Fictional ${classification} button`);
    await page.getByTestId('save-event-type-btn').click();
    await untilRows(page, 'participationEventTypes', types => types.some(t => t.name === `Fictional ${classification} button`));
  }
  assert.deepEqual((await rows(page, 'participationEventTypes')).filter(t => initialTypes.some(i => i.id === t.id)), initialTypes);
  assert.deepEqual(await rows(page, 'participationEvents'), initialEvents);
  assert.deepEqual(await rows(page, 'categoryResults'), formalResults);
  await page.getByRole('button', { name: 'Class View (Seating)', exact: true }).click();
  await page.getByTestId('student-seat-name').first().click();
  for (const classification of ['positive', 'neutral', 'needs_followup']) {
    const button = page.getByRole('button', { name: `Record Fictional ${classification} button`, exact: true });
    const tooltip = await button.getAttribute('title');
    assert.ok(tooltip?.includes('No formal grade impact.'));
    assert.ok(tooltip?.includes('tally point'));
    assert.ok((await button.boundingBox())!.height >= 44);
  }
  await page.getByTestId('toggle-note-btn').click();
  await page.getByTestId('observation-note-input').fill('Fictional settings acceptance snapshot');
  await page.getByRole('button', { name: 'Record Fictional positive button', exact: true }).click();
  const withObservation = await untilRows(page, 'participationEvents', events => events.some(e => e.note === 'Fictional settings acceptance snapshot'));
  // Successful recording deliberately clears selection and closes the dock.
  await page.getByTestId('configure-participation-btn').waitFor({ state: 'hidden' });
  await page.getByTestId('student-seat-name').first().click();
  await page.getByTestId('configure-participation-btn').click();
  await page.getByRole('heading', { name: 'Grading Policies & Observation Settings', exact: true }).waitFor();

  // Bound fixture: empty only the fictional button configuration to exercise a workspace with no presets.
  // Successful setup remains a real UI action through the authorized transaction. No production cleanup is invoked.
  const fixture = await rows(page, 'participationEventTypes');
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result, tx = database.transaction('participationEventTypes', 'readwrite');
      tx.objectStore('participationEventTypes').clear();
      tx.oncomplete = () => { database.close(); resolve(); };
      tx.onerror = () => { database.close(); reject(tx.error); };
    };
  }));
  // Reload to verify the empty configuration through a fresh actual UI session.
  await page.reload();
  await page.getByTestId('participation-empty-state').waitFor();
  for (const classification of ['positive', 'neutral', 'needs_followup']) {
    assert.ok(await page.getByTestId(`create-${classification}-button`).isEnabled());
  }
  await page.getByTestId('add-starter-buttons-btn').click();
  const starters = await untilRows(page, 'participationEventTypes', types => types.length === 4);
  assert.deepEqual(starters.map(t => t.classification).sort(), ['needs_followup', 'neutral', 'neutral', 'positive']);
  assert.equal(await page.getByTestId('add-starter-buttons-btn').count(), 0);
  assert.deepEqual(await rows(page, 'participationEvents'), withObservation);
  assert.deepEqual(await rows(page, 'categoryResults'), formalResults);
  // A settings revisit is read-only and does not double-create defaults.
  await page.getByRole('button', { name: 'Class View (Seating)', exact: true }).click();
  await settings(page);
  assert.deepEqual(await rows(page, 'participationEventTypes'), starters);
  await page.setViewportSize({ width: 390, height: 844 });
  await noOverflow(page);
  for (const classification of ['positive', 'neutral', 'needs_followup']) {
    const action = page.getByTestId(`create-${classification}-button`);
    await action.scrollIntoViewIfNeeded();
    assert.ok((await action.boundingBox())!.height >= 44);
  }
  // Restore the fixture to its original configuration; acceptance-created observations remain snapshots.
  await page.evaluate(fixture => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result, tx = database.transaction('participationEventTypes', 'readwrite');
      const store = tx.objectStore('participationEventTypes'); store.clear();
      fixture.forEach(row => store.put(row));
      tx.oncomplete = () => { database.close(); resolve(); };
      tx.onerror = () => { database.close(); reject(tx.error); };
    };
  }), fixture);
  console.log('PASS: class preset displays actual scale values; all participation classifications have creation actions/tooltips and 44px targets; explicit fictional empty-workspace starter setup preserves history/formal grades and never reseeds on revisit; narrow Settings does not overflow.');
}
