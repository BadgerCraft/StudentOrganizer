import { createServer, type ViteDevServer } from 'vite';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import path from 'path';
import fs from 'fs';

function parseBadgeCounter(text: string | null): number {
  if (!text) return 0;
  const trimmed = text.trim();
  if (trimmed === 'No events') return 0;
  const match = trimmed.match(/[+!]?(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

async function countSessionsInIndexedDB(page: Page): Promise<number> {
  return await page.evaluate(async () => {
    return new Promise<number>((resolve, reject) => {
      const req = indexedDB.open('OntarioTeacherAssessmentDB');
      req.onsuccess = () => {
        const idb = req.result;
        try {
          const tx = idb.transaction('classSessions', 'readonly');
          const store = tx.objectStore('classSessions');
          const countReq = store.count();
          countReq.onsuccess = () => resolve(countReq.result);
          countReq.onerror = () => reject(countReq.error);
        } catch (e) {
          reject(e);
        }
      };
      req.onerror = () => reject(req.error);
    });
  });
}

async function countEventsInIndexedDB(page: Page): Promise<number> {
  return await page.evaluate(async () => {
    return new Promise<number>((resolve, reject) => {
      const req = indexedDB.open('OntarioTeacherAssessmentDB');
      req.onsuccess = () => {
        const idb = req.result;
        try {
          const tx = idb.transaction('participationEvents', 'readonly');
          const store = tx.objectStore('participationEvents');
          const countReq = store.count();
          countReq.onsuccess = () => resolve(countReq.result);
          countReq.onerror = () => reject(countReq.error);
        } catch (e) {
          reject(e);
        }
      };
      req.onerror = () => reject(req.error);
    });
  });
}

async function main() {
  const artifactDir = process.env.ARTIFACT_DIR || path.resolve(process.cwd(), 'screenshots');
  if (!fs.existsSync(artifactDir)) {
    fs.mkdirSync(artifactDir, { recursive: true });
  }

  console.log(`Starting Vite server on port 5174... (Artifacts: ${artifactDir})`);
  let server: ViteDevServer | null = null;
  let browser: Browser | null = null;
  let runError: Error | null = null;

  try {
    server = await createServer({
      server: { port: 5174, strictPort: true },
      logLevel: 'error'
    });
    await server.listen();
    console.log('Vite server running at http://localhost:5174');

    console.log('Launching Chromium...');
    browser = await chromium.launch({ headless: true });
    const context: BrowserContext = await browser.newContext({
      viewport: { width: 1440, height: 900 }
    });
    const page: Page = await context.newPage();

    const pageErrors: Error[] = [];
    page.on('pageerror', err => {
      console.error(`[Browser PageError] ${err.message}`);
      pageErrors.push(err);
    });
    page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error(`[Browser Console Error] ${msg.text()}`);
        pageErrors.push(new Error(msg.text()));
      }
    });

    console.log('Navigating to app...');
    await page.goto('http://localhost:5174');
    await page.waitForTimeout(2000); // Allow seeds to initialize

    // Screenshot 1: Dashboard View
    console.log('Capturing Step 1: Dashboard View...');
    await page.screenshot({ path: path.join(artifactDir, 'workflow_step1_dashboard.png') });

    // Step 1: Open first class
    console.log('Opening class workspace...');
    const classCard = page.getByRole('button', { name: /open workspace/i }).first();
    await classCard.waitFor({ state: 'visible', timeout: 5000 });
    await classCard.click();
    await page.waitForTimeout(1000);

    // Screenshot 2: Class Seating View
    console.log('Capturing Step 2: Class View...');
    await page.screenshot({ path: path.join(artifactDir, 'workflow_step2_class_view.png') });

    // Step 2: Read baseline counter on Today
    console.log('Observing Today baseline counter...');
    const studentCards = await page.locator('[data-testid="student-seat-card"]').all();
    if (studentCards.length < 2) {
      throw new Error(`Expected at least 2 student cards in seating chart, found ${studentCards.length}`);
    }
    const initialBadgeText0 = await studentCards[0].locator('[data-testid="student-counter-badge"]').first().textContent();
    const baselineToday0 = parseBadgeCounter(initialBadgeText0);
    console.log(`Observed baseline counter for student 0 on Today: ${baselineToday0}`);

    // Step 3: Zero-Write Date Browsing Verification
    console.log('Verifying zero-write date browsing...');
    const sessionCountBefore = await countSessionsInIndexedDB(page);
    console.log(`IndexedDB session count before browsing: ${sessionCountBefore}`);

    const prevDayBtn = page.locator('[data-testid="prev-day-btn"]');
    await prevDayBtn.click();
    await page.waitForTimeout(500);

    const historicalBadge = page.locator('[data-testid="historical-badge"]');
    await historicalBadge.waitFor({ state: 'visible', timeout: 3000 });

    const sessionCountAfter = await countSessionsInIndexedDB(page);
    console.log(`IndexedDB session count after browsing: ${sessionCountAfter}`);
    if (sessionCountAfter !== sessionCountBefore) {
      throw new Error(`Date browsing created unrequested session! Expected ${sessionCountBefore}, got ${sessionCountAfter}`);
    }

    // Step 4: Record Participation with Observation Note on Historical Date
    console.log('Observing Previous Day baseline counter...');
    const prevBadgeText0 = await studentCards[0].locator('[data-testid="student-counter-badge"]').first().textContent();
    const baselinePrev0 = parseBadgeCounter(prevBadgeText0);
    console.log(`Observed baseline counter for student 0 on Previous Day: ${baselinePrev0}`);

    console.log('Selecting student on Previous Day...');
    await studentCards[0].click();
    await page.waitForTimeout(400);

    // Assert historical warning appears in dock
    const historicalNotice = page.locator('[data-testid="historical-date-warning"]');
    await historicalNotice.waitFor({ state: 'visible', timeout: 3000 });

    // Add observation note
    console.log('Adding observation note...');
    const toggleNoteBtn = page.locator('[data-testid="toggle-note-btn"]');
    await toggleNoteBtn.click();
    const noteInput = page.locator('[data-testid="observation-note-input"]');
    await noteInput.waitFor({ state: 'visible', timeout: 3000 });
    await noteInput.fill('Exemplary historical source critique');

    // Screenshot 3: Student Selected on Historical Date with Note & Dock
    console.log('Capturing Step 3: Historical Date with Note & Dock...');
    await page.screenshot({ path: path.join(artifactDir, 'workflow_step3_historical_dock.png') });

    // Record event
    console.log('Recording participation event by accessible name ("Used evidence")...');
    const eventBtn = page.getByRole('button', { name: /used evidence/i });
    await eventBtn.waitFor({ state: 'visible', timeout: 5000 });
    await eventBtn.click();
    await page.waitForTimeout(800);

    // Screenshot 4: Recorded on Historical Date
    console.log('Capturing Step 4: Recorded on Historical Date...');
    await page.screenshot({ path: path.join(artifactDir, 'workflow_step4_recorded_historical.png') });

    // Assert counter increased relative to baseline on Previous Day
    const postRecordBadgeText0 = await studentCards[0].locator('[data-testid="student-counter-badge"]').first().textContent();
    const postRecordPrev0 = parseBadgeCounter(postRecordBadgeText0);
    console.log(`Observed post-record counter on Previous Day: ${postRecordPrev0} (expected: ${baselinePrev0 + 1})`);
    if (postRecordPrev0 !== baselinePrev0 + 1) {
      throw new Error(`Counter assertion failed: expected ${baselinePrev0 + 1}, got ${postRecordPrev0}`);
    }

    // Step 5: Verify Date Separation
    console.log('Verifying date isolation (navigating to Today)...');
    const todayBtn = page.locator('[data-testid="today-btn"]');
    await todayBtn.click();
    await page.waitForTimeout(500);

    const reloadedTodayBadgeText0 = await studentCards[0].locator('[data-testid="student-counter-badge"]').first().textContent();
    const reloadedToday0 = parseBadgeCounter(reloadedTodayBadgeText0);
    console.log(`Observed Today counter: ${reloadedToday0} (expected baseline: ${baselineToday0})`);
    if (reloadedToday0 !== baselineToday0) {
      throw new Error(`Date separation failed: Today counter modified! Expected ${baselineToday0}, got ${reloadedToday0}`);
    }

    // Step 6: Inspect Participation Ledger, Edit Note, and Retract Event
    console.log('Navigating to Participation Ledger view...');
    const ledgerTab = page.getByRole('button', { name: /participation/i }).first();
    await ledgerTab.click();
    await page.waitForTimeout(1000);

    // Screenshot 5: Participation Ledger View
    console.log('Capturing Step 5: Participation Ledger...');
    await page.screenshot({ path: path.join(artifactDir, 'workflow_step5_ledger_view.png') });

    // Verify row has note and formatted Toronto time (no UTC label)
    const ledgerRow = page.locator('[data-testid="ledger-event-row"]').filter({ hasText: 'Exemplary historical source critique' }).first();
    await ledgerRow.waitFor({ state: 'visible', timeout: 5000 });
    const rowText = await ledgerRow.textContent();
    if (!rowText?.includes('Exemplary historical source critique')) {
      throw new Error(`Observation note not visible in ledger table row: ${rowText}`);
    }
    if (rowText?.includes('UTC')) {
      throw new Error(`Raw UTC string found in ledger table row! Expected America/Toronto local format: ${rowText}`);
    }

    // Edit Note
    console.log('Editing observation note in Ledger...');
    const editNoteBtn = ledgerRow.locator('[data-testid="edit-note-btn"]');
    await editNoteBtn.click();
    const editNoteTextarea = page.locator('[data-testid="edit-note-textarea"]');
    await editNoteTextarea.waitFor({ state: 'visible', timeout: 3000 });
    await editNoteTextarea.fill('Refined historical critique with primary evidence');
    const saveNoteBtn = page.locator('[data-testid="save-edit-note-btn"]');
    await saveNoteBtn.click();
    await page.waitForTimeout(800);

    // Verify edited note text displays
    const updatedLedgerRow = page.locator('[data-testid="ledger-event-row"]').filter({ hasText: 'Refined historical critique with primary evidence' }).first();
    await updatedLedgerRow.waitFor({ state: 'visible', timeout: 3000 });
    const updatedRowText = await updatedLedgerRow.textContent();
    if (!updatedRowText?.includes('Refined historical critique with primary evidence')) {
      throw new Error(`Edited note not visible after saving: ${updatedRowText}`);
    }
    console.log('Note update verified in Ledger.');

    // Retract Event (Clean up test data)
    console.log('Retracting observation event in Ledger (clean-up)...');
    const retractBtn = updatedLedgerRow.locator('[data-testid="retract-event-btn"]');
    await retractBtn.click();
    const retractReasonInput = page.locator('[data-testid="retract-reason-input"]');
    await retractReasonInput.waitFor({ state: 'visible', timeout: 3000 });
    await retractReasonInput.fill('Workflow test cleanup');
    const confirmRetractBtn = page.locator('[data-testid="confirm-retract-btn"]');
    await confirmRetractBtn.click();
    await page.waitForTimeout(1000);

    // Step 7: Confirm Return to Baseline on Previous Day and Reload Persistence
    console.log('Returning to Seating View to verify baseline restoration...');
    const seatingTab = page.getByRole('button', { name: /class view \(seating\)/i }).first();
    await seatingTab.click();
    await page.waitForTimeout(600);

    // Verify date is on Previous Day
    const isHistorical = await page.locator('[data-testid="historical-badge"]').isVisible();
    if (!isHistorical) {
      await page.locator('[data-testid="prev-day-btn"]').click();
      await page.waitForTimeout(500);
    }

    const postRetractBadgeText0 = await page.locator('[data-testid="student-seat-card"]').first().locator('[data-testid="student-counter-badge"]').first().textContent();
    const postRetract0 = parseBadgeCounter(postRetractBadgeText0);
    console.log(`Observed counter after retraction on Previous Day: ${postRetract0} (expected baseline: ${baselinePrev0})`);
    if (postRetract0 !== baselinePrev0) {
      throw new Error(`Counter did not return to baseline after retraction: expected ${baselinePrev0}, got ${postRetract0}`);
    }

    // Step 8: Configurable Participation Buttons & Level 1–4 Observational Flow
    console.log('Navigating to Settings view to create a custom Level 1–4 button...');
    const settingsTab = page.getByRole('button', { name: /settings/i }).first();
    await settingsTab.click();
    await page.waitForTimeout(800);

    // Click New Button
    const createBtn = page.locator('[data-testid="create-event-type-btn"]');
    await createBtn.click();
    await page.waitForTimeout(400);

    // Fill Create Modal
    console.log('Configuring new Level 1–4 button in Settings...');
    const nameInput = page.locator('[data-testid="event-type-name-input"]');
    await nameInput.fill('Synthesis & Critique');

    const classSelect = page.locator('[data-testid="event-type-classification-select"]');
    await classSelect.selectOption('neutral');

    const modeSelect = page.locator('[data-testid="event-type-mode-select"]');
    await modeSelect.selectOption('level_1_4');

    const catSelect = page.locator('[data-testid="event-type-category-select"]');
    await catSelect.selectOption('T');

    // Submit
    const saveBtn = page.locator('[data-testid="save-event-type-btn"]');
    await saveBtn.click();
    await page.waitForTimeout(800);

    // Verify row appeared in Settings
    const buttonRow = page.locator('[data-testid="event-type-row"]').filter({ hasText: 'Synthesis & Critique' }).first();
    await buttonRow.waitFor({ state: 'visible', timeout: 5000 });
    console.log('New button verified in Settings list.');

    // Return to Seating View
    console.log('Returning to Seating View to test Level 1–4 recording dock...');
    await seatingTab.click();
    await page.waitForTimeout(800);

    // Select student 0
    const studentCardsAfter = await page.locator('[data-testid="student-seat-card"]').all();
    await studentCardsAfter[0].click();
    await page.waitForTimeout(500);

    // Find the new button in the dock
    const customDockBtn = page.getByRole('button', { name: /synthesis & critique/i });
    await customDockBtn.waitFor({ state: 'visible', timeout: 5000 });

    // Prove 0 writes prior to level selection
    console.log('Verifying zero write prior to level selection...');
    const evCountBeforeCancel = await countEventsInIndexedDB(page);
    await customDockBtn.click();
    await page.waitForTimeout(400);

    const levelModal = page.locator('[data-testid="level-selector-tray"]');
    await levelModal.waitFor({ state: 'visible', timeout: 3000 });

    // Click Cancel
    const cancelLevelBtn = page.locator('[data-testid="cancel-level-btn"]');
    await cancelLevelBtn.click();
    await page.waitForTimeout(400);

    const evCountAfterCancel = await countEventsInIndexedDB(page);
    if (evCountAfterCancel !== evCountBeforeCancel) {
      throw new Error(`Zero-write assertion failed! Cancel wrote ${evCountAfterCancel - evCountBeforeCancel} event(s).`);
    }
    console.log('Zero write on cancel verified.');

    // Record Level 3
    console.log('Recording Level 3 via modal...');
    await customDockBtn.click();
    await page.waitForTimeout(400);

    const level3Btn = page.locator('[data-testid="level-3-btn"]');
    await level3Btn.click();
    await page.waitForTimeout(800);

    const evCountAfterRecord = await countEventsInIndexedDB(page);
    if (evCountAfterRecord !== evCountBeforeCancel + 1) {
      throw new Error(`Record assertion failed: expected ${evCountBeforeCancel + 1} events, found ${evCountAfterRecord}`);
    }
    console.log('Level 3 recorded successfully.');

    // Verify Ledger Display
    console.log('Verifying Level 1–4 snapshot in Participation Ledger...');
    await ledgerTab.click();
    await page.waitForTimeout(800);

    const levelLedgerRow = page.locator('[data-testid="ledger-event-row"]').filter({ hasText: 'Synthesis & Critique' }).first();
    await levelLedgerRow.waitFor({ state: 'visible', timeout: 5000 });
    const levelRowText = await levelLedgerRow.textContent();
    if (!levelRowText?.includes('Level Evidence') || !levelRowText?.includes('Level 3')) {
      throw new Error(`Ledger row does not display expected Level Evidence and Level 3: ${levelRowText}`);
    }
    console.log('Ledger row verified with Level Evidence and Level 3.');

    // Edit Isolation: Rename in Settings, verify Ledger retains original snapshot
    console.log('Testing edit isolation (editing button name in Settings)...');
    await settingsTab.click();
    await page.waitForTimeout(800);

    const rowToEdit = page.locator('[data-testid="event-type-row"]').filter({ hasText: 'Synthesis & Critique' }).first();
    const editBtn = rowToEdit.locator('[data-testid="edit-event-type-btn"]');
    await editBtn.click();
    await page.waitForTimeout(400);

    const editNameInput = page.locator('[data-testid="edit-event-type-name-input"]');
    await editNameInput.fill('Synthesis & Critique (Updated)');
    const saveEditBtn = page.locator('[data-testid="save-edit-event-type-btn"]');
    await saveEditBtn.click();
    await page.waitForTimeout(800);

    // Check Ledger still shows original name "Synthesis & Critique"
    await ledgerTab.click();
    await page.waitForTimeout(800);

    const preservedRow = page.locator('[data-testid="ledger-event-row"]').filter({ hasText: 'Synthesis & Critique' }).first();
    const preservedText = await preservedRow.textContent();
    if (preservedText?.includes('(Updated)')) {
      throw new Error(`Edit isolation failed: historical event name was overwritten by current button name! Text: ${preservedText}`);
    }
    console.log('Edit isolation verified: historical event preserves snapshotted name.');

    // Archive Button Test
    console.log('Testing button archiving...');
    await settingsTab.click();
    await page.waitForTimeout(800);

    const rowToArchive = page.locator('[data-testid="event-type-row"]').filter({ hasText: 'Synthesis & Critique (Updated)' }).first();
    const archiveBtn = rowToArchive.locator('[data-testid="archive-event-type-btn"]');
    await archiveBtn.click();
    await page.waitForTimeout(400);

    const confirmArchiveBtn = page.locator('[data-testid="confirm-archive-btn"]');
    await confirmArchiveBtn.click();
    await page.waitForTimeout(800);

    // Verify button is gone from Seating View dock
    await seatingTab.click();
    await page.waitForTimeout(800);
    const cardsAgain = await page.locator('[data-testid="student-seat-card"]').all();
    await cardsAgain[0].click();
    await page.waitForTimeout(400);

    const archivedDockBtn = page.getByRole('button', { name: /synthesis & critique/i });
    const isDockVisible = await archivedDockBtn.isVisible();
    if (isDockVisible) {
      throw new Error('Archived button still visible in active participation dock!');
    }
    console.log('Archived button removal from dock verified.');

    // Clean up Level 3 test event in Ledger
    console.log('Cleaning up Level 3 test event in Ledger...');
    await ledgerTab.click();
    await page.waitForTimeout(800);

    const cleanupRow = page.locator('[data-testid="ledger-event-row"]').filter({ hasText: 'Synthesis & Critique' }).first();
    const cleanupRetractBtn = cleanupRow.locator('[data-testid="retract-event-btn"]');
    await cleanupRetractBtn.click();
    await page.waitForTimeout(400);

    const retractReason = page.locator('[data-testid="retract-reason-input"]');
    await retractReason.fill('Test cleanup');
    await page.locator('[data-testid="confirm-retract-btn"]').click();
    await page.waitForTimeout(800);

    // Step 9: Reload page and confirm clean persistence
    console.log('Reloading page to verify persistence...');
    await page.reload();
    await page.waitForTimeout(2000);

    // Screenshot 6: Clean Reloaded State
    console.log('Capturing Step 6: Reloaded Clean State...');
    await page.screenshot({ path: path.join(artifactDir, 'workflow_step6_reloaded_clean.png') });

    // Assert zero browser or unhandled console errors
    if (pageErrors.length > 0) {
      throw new Error(`Workflow encountered ${pageErrors.length} browser/page error(s): ${pageErrors[0].message}`);
    }

    console.log('WORKFLOW_INSPECTION_COMPLETE: All assertions passed with 0 browser errors and clean cleanup.');
  } catch (err: any) {
    console.error('Workflow test error:', err.message || err);
    runError = err;
    process.exitCode = 1;
  } finally {
    console.log('Cleaning up browser and Vite server...');
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (server) {
      await server.close().catch(() => {});
    }
    if (runError) {
      throw runError;
    }
  }
}

main().catch(err => {
  console.error('Workflow runner failed:', err.message || err);
  process.exitCode = 1;
});
