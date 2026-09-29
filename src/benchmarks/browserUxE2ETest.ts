import { createServer, type ViteDevServer } from 'vite';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import path from 'path';
import fs from 'fs';

interface IndexedDBTestResult {
  hasUnit: boolean;
  unitCode?: string;
  hasPolicy: boolean;
  policyWeights?: { k: number; t: number; c: number; a: number };
  hasLayout: boolean;
  layoutDims?: { rows: number; cols: number };
  hasStaff: boolean;
  staffRole?: string;
  staffUser?: string;
}

async function verifySectionEntitiesInIndexedDB(page: Page, sectionId: string): Promise<IndexedDBTestResult> {
  return await page.evaluate(async (secId) => {
    return new Promise<IndexedDBTestResult>((resolve, reject) => {
      const req = indexedDB.open('OntarioTeacherAssessmentDB');
      req.onsuccess = () => {
        const idb = req.result;
        try {
          const tx = idb.transaction(
            ['units', 'gradingPolicies', 'seatingLayouts', 'classSectionStaff', 'organizationMemberships'],
            'readonly'
          );

          let hasUnit = false;
          let unitCode = '';
          let hasPolicy = false;
          let policyWeights: any = null;
          let hasLayout = false;
          let layoutDims: any = null;
          let hasStaff = false;
          let staffRole = '';
          let staffMembershipId = '';
          let staffUser = '';

          const unitStore = tx.objectStore('units');
          const unitReq = unitStore.getAll();
          unitReq.onsuccess = () => {
            const units = (unitReq.result || []).filter((u: any) => u.classSectionId === secId && u.deletedAt === null);
            if (units.length > 0) {
              hasUnit = true;
              unitCode = units[0].code;
            }
          };

          const policyStore = tx.objectStore('gradingPolicies');
          const policyReq = policyStore.getAll();
          policyReq.onsuccess = () => {
            const policies = (policyReq.result || []).filter((p: any) => p.classSectionId === secId && p.deletedAt === null);
            if (policies.length > 0) {
              hasPolicy = true;
              policyWeights = {
                k: policies[0].weightK,
                t: policies[0].weightT,
                c: policies[0].weightC,
                a: policies[0].weightA
              };
            }
          };

          const layoutStore = tx.objectStore('seatingLayouts');
          const layoutReq = layoutStore.getAll();
          layoutReq.onsuccess = () => {
            const layouts = (layoutReq.result || []).filter((l: any) => l.classSectionId === secId && l.deletedAt === null);
            if (layouts.length > 0) {
              hasLayout = true;
              layoutDims = { rows: layouts[0].rows, cols: layouts[0].cols };
            }
          };

          const staffStore = tx.objectStore('classSectionStaff');
          const staffReq = staffStore.getAll();
          staffReq.onsuccess = () => {
            const staff = (staffReq.result || []).filter((s: any) => s.classSectionId === secId && s.deletedAt === null);
            if (staff.length > 0) {
              hasStaff = true;
              staffRole = staff[0].role;
              staffMembershipId = staff[0].organizationMembershipId;
            }
          };

          const memStore = tx.objectStore('organizationMemberships');
          const memReq = memStore.getAll();
          memReq.onsuccess = () => {
            const mems = memReq.result || [];
            const matchingMem = mems.find((m: any) => m.id === staffMembershipId);
            if (matchingMem) {
              staffUser = matchingMem.userId;
            }
          };

          tx.oncomplete = () => {
            resolve({
              hasUnit,
              unitCode,
              hasPolicy,
              policyWeights,
              hasLayout,
              layoutDims,
              hasStaff,
              staffRole,
              staffUser
            });
          };

          tx.onerror = () => reject(tx.error);
        } catch (e) {
          reject(e);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }, sectionId);
}

async function verifyStudentInIndexedDB(page: Page, studentNumber: string): Promise<any> {
  return await page.evaluate(async (stdNum) => {
    return new Promise<any>((resolve, reject) => {
      const req = indexedDB.open('OntarioTeacherAssessmentDB');
      req.onsuccess = () => {
        const idb = req.result;
        try {
          const tx = idb.transaction(['students'], 'readonly');
          const store = tx.objectStore('students');
          const getReq = store.getAll();
          getReq.onsuccess = () => {
            const match = (getReq.result || []).find((s: any) => s.localStudentNumber === stdNum && s.deletedAt === null);
            resolve(match || null);
          };
          getReq.onerror = () => reject(getReq.error);
        } catch (e) {
          reject(e);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }, studentNumber);
}

async function getAllSectionsInIndexedDB(page: Page): Promise<any[]> {
  return await page.evaluate(async () => {
    return new Promise<any[]>((resolve, reject) => {
      const req = indexedDB.open('OntarioTeacherAssessmentDB');
      req.onsuccess = () => {
        const idb = req.result;
        try {
          const tx = idb.transaction(['classSections'], 'readonly');
          const store = tx.objectStore('classSections');
          const getReq = store.getAll();
          getReq.onsuccess = () => resolve(getReq.result || []);
          getReq.onerror = () => reject(getReq.error);
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

  const port = 5176;
  console.log(`Starting Vite server on port ${port}...`);
  let server: ViteDevServer | null = null;
  let browser: Browser | null = null;
  let runError: Error | null = null;

  try {
    server = await createServer({
      server: { port, strictPort: true },
      logLevel: 'error'
    });
    await server.listen();
    console.log(`Vite server running at http://localhost:${port}`);

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
    await page.goto(`http://localhost:${port}`);
    await page.waitForTimeout(2000); // Wait for seeds to finish initializing

    // In V6.3+, an acting teacher must be explicitly selected on launch
    const teacherModal = page.locator('[data-testid="teacher-selector-modal"]');
    if (await teacherModal.isVisible()) {
      console.log('Teacher selector modal is visible, selecting Taylor Demo...');
      const tylerBtn = page.locator('[data-testid="select-teacher-user-tyler"]');
      if (await tylerBtn.isVisible()) {
        await tylerBtn.click();
      } else {
        const firstTeacherBtn = page.locator('[data-testid^="select-teacher-"]').first();
        await firstTeacherBtn.waitFor({ state: 'visible', timeout: 5000 });
        await firstTeacherBtn.click();
      }
      await teacherModal.waitFor({ state: 'hidden', timeout: 5000 });
      console.log('Teacher selected successfully.');
    }

    // =========================================================================
    // TEST 1: Modal Initial Focus & Typing Stability (Create Class)
    // =========================================================================
    console.log('\n--- Test 1A: Create Class Modal Focus Stability ---');
    const openCreateBtn = page.locator('[data-testid="create-class-open-btn"]');
    await openCreateBtn.waitFor({ state: 'visible', timeout: 5000 });
    await openCreateBtn.click();

    const createModal = page.locator('[data-testid="create-class-modal"]');
    await createModal.waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(300);

    // Assert initial focus is on the course code input
    const initialFocusedTag1 = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? { tagName: el.tagName, id: el.id, testId: el.getAttribute('data-testid') } : null;
    });
    console.log('Initial focused element in Create Class Modal:', initialFocusedTag1);
    if (initialFocusedTag1?.id !== 'course-code-input' && initialFocusedTag1?.testId !== 'new-course-code-input') {
      throw new Error(`Expected focus on course code input, but got: ${JSON.stringify(initialFocusedTag1)}`);
    }

    // Type text and verify focus does not jump away
    console.log('Typing into course code input and checking focus stability...');
    const courseCodeInput = page.locator('[data-testid="new-course-code-input"]');
    await courseCodeInput.pressSequentially('SCH4U', { delay: 50 });

    const postTypingFocus1 = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? { tagName: el.tagName, id: el.id, testId: el.getAttribute('data-testid') } : null;
    });
    console.log('Post-typing focused element in Create Class Modal:', postTypingFocus1);
    if (postTypingFocus1?.id !== 'course-code-input' && postTypingFocus1?.testId !== 'new-course-code-input') {
      throw new Error(`Focus jumped away while typing in Create Class Modal! Current focus: ${JSON.stringify(postTypingFocus1)}`);
    }

    // Close Create Class Modal with Cancel (dirty confirm will trigger if we click outside or cancel)
    console.log('Cancelling Create Class Modal...');
    // Set up dialog handler for dirty discard
    let dialogTriggered = false;
    page.once('dialog', async dialog => {
      dialogTriggered = true;
      console.log(`[Dialog received] ${dialog.message()}`);
      await dialog.accept();
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    if (!dialogTriggered) {
      throw new Error('Expected dirty discard confirmation dialog when closing Create Class Modal with unsaved text!');
    }
    await createModal.waitFor({ state: 'hidden', timeout: 3000 });
    console.log('Create Class Modal dismissed with confirmation.');

    // =========================================================================
    // TEST 2: Student Settings Modal Focus & Hidden Input Skipping
    // =========================================================================
    console.log('\n--- Test 2: Student Settings Modal Focus (Skips Hidden File Input) ---');
    // Open the first class workspace
    const openWorkspaceBtn = page.locator('[data-testid="chiclet-open-overlay-btn"]').first();
    await openWorkspaceBtn.waitFor({ state: 'visible', timeout: 5000 });
    await openWorkspaceBtn.click();
    await page.waitForTimeout(1000);

    // In Seating View, click the settings gear on the first student card
    const studentSettingsGear = page.locator('[data-testid="student-settings-gear-btn"]').first();
    await studentSettingsGear.waitFor({ state: 'visible', timeout: 5000 });
    await studentSettingsGear.click();

    const studentSettingsModal = page.locator('[data-testid="student-settings-modal"]');
    await studentSettingsModal.waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(400);

    // Assert initial focus is on student-first-name-input (NOT hidden file input!)
    const initialFocusedTag2 = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? { tagName: el.tagName, testId: el.getAttribute('data-testid'), type: (el as any).type } : null;
    });
    console.log('Initial focused element in Student Settings Modal:', initialFocusedTag2);
    if (initialFocusedTag2?.testId !== 'student-first-name-input') {
      throw new Error(`Expected focus on student-first-name-input, but got: ${JSON.stringify(initialFocusedTag2)}`);
    }

    // Type text into first name and ensure focus stays
    console.log('Typing into student first name input and checking focus stability...');
    const firstNameInput = page.locator('[data-testid="student-first-name-input"]');
    await firstNameInput.pressSequentially(' Edited', { delay: 50 });

    const postTypingFocus2 = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? { tagName: el.tagName, testId: el.getAttribute('data-testid') } : null;
    });
    console.log('Post-typing focused element in Student Settings Modal:', postTypingFocus2);
    if (postTypingFocus2?.testId !== 'student-first-name-input') {
      throw new Error(`Focus jumped away while typing in Student Settings Modal! Current focus: ${JSON.stringify(postTypingFocus2)}`);
    }

    // Cancel and dismiss
    dialogTriggered = false;
    page.once('dialog', async dialog => {
      dialogTriggered = true;
      console.log(`[Dialog received] ${dialog.message()}`);
      await dialog.accept();
    });
    const cancelSettingsBtn = page.locator('[data-testid="cancel-student-settings-btn"]');
    await cancelSettingsBtn.click();
    await page.waitForTimeout(500);
    if (!dialogTriggered) {
      throw new Error('Expected dirty discard confirmation dialog when closing Student Settings with unsaved name changes!');
    }
    await studentSettingsModal.waitFor({ state: 'hidden', timeout: 3000 });
    console.log('Student Settings Modal dismissed with confirmation.');

    // =========================================================================
    // TEST 3: Profile Draft Protection (Custom Assessment, Notes, Overrides)
    // =========================================================================
    console.log('\n--- Test 3: Student Profile Draft Protection Across Forms ---');
    // Open full student profile
    const openProfileBtn = page.locator('[data-testid="open-student-profile-btn"]').first();
    await openProfileBtn.waitFor({ state: 'visible', timeout: 5000 });
    await openProfileBtn.click();

    const profileModal = page.locator('[data-testid="student-profile-modal"]');
    await profileModal.waitFor({ state: 'visible', timeout: 5000 });
    await page.waitForTimeout(400);

    // Case 3A: Custom Assessment Draft
    console.log('Testing custom assessment draft protection...');
    const assessmentsTab = page.locator('[data-testid="profile-tab-assessments"]');
    await assessmentsTab.click();
    await page.waitForTimeout(300);

    const addAssignmentBtn = page.locator('[data-testid="profile-add-assignment-btn"]');
    await addAssignmentBtn.click();

    const customTitleInput = page.locator('[data-testid="custom-assessment-title-input"]');
    await customTitleInput.waitFor({ state: 'visible', timeout: 3000 });
    await customTitleInput.fill('Midterm Oral Presentation Draft');

    // Attempt to close profile via 'X' close button
    console.log('Attempting to close profile with dirty custom assessment draft...');
    dialogTriggered = false;
    page.once('dialog', async dialog => {
      dialogTriggered = true;
      console.log(`[Dialog received] ${dialog.message()}`);
      // Cancel the dialog to preserve draft
      await dialog.dismiss();
    });
    const profileCloseBtn = page.locator('[data-testid="profile-close-btn"]');
    await profileCloseBtn.click();
    await page.waitForTimeout(500);
    if (!dialogTriggered) {
      throw new Error('Expected discard confirmation when closing profile with dirty custom assessment draft!');
    }
    // Profile must still be open
    const isProfileStillOpen = await profileModal.isVisible();
    if (!isProfileStillOpen) {
      throw new Error('Profile closed despite user dismissing discard dialog!');
    }
    console.log('Profile stayed open after dismiss was rejected.');

    // Test toggle guard: click Hide Assignment Form
    console.log('Testing toggle discard guard on custom assessment form...');
    dialogTriggered = false;
    page.once('dialog', async dialog => {
      dialogTriggered = true;
      console.log(`[Dialog received on toggle] ${dialog.message()}`);
      await dialog.accept(); // Accept discard
    });
    await addAssignmentBtn.click();
    await page.waitForTimeout(500);
    if (!dialogTriggered) {
      throw new Error('Expected confirmation dialog when collapsing custom assessment form with dirty draft!');
    }
    // Form should now be hidden
    await customTitleInput.waitFor({ state: 'hidden', timeout: 3000 });
    console.log('Custom assessment form cleanly discarded on user confirmation.');

    // Case 3B: Notes Draft & Settings Gear Guard
    console.log('Testing private note draft protection and settings gear guard...');
    const notesTab = page.locator('[data-testid="profile-tab-notes"]');
    await notesTab.click();
    await page.waitForTimeout(300);

    const noteTextarea = page.locator('[data-testid="profile-note-textarea"]');
    await noteTextarea.fill('Observation draft in progress...');

    // Attempt to open Settings from Profile header
    dialogTriggered = false;
    page.once('dialog', async dialog => {
      dialogTriggered = true;
      console.log(`[Dialog received on gear click] ${dialog.message()}`);
      await dialog.dismiss(); // Cancel
    });
    const profileGearBtn = page.locator('[data-testid="profile-settings-gear-btn"]');
    await profileGearBtn.click();
    await page.waitForTimeout(500);
    if (!dialogTriggered) {
      throw new Error('Expected confirmation dialog when navigating to Settings from Profile with unsaved note!');
    }
    // Modal must still be Profile, not Settings
    if (!(await profileModal.isVisible()) || (await studentSettingsModal.isVisible())) {
      throw new Error('Navigated to Settings despite cancelling discard dialog!');
    }
    console.log('Gear navigation aborted cleanly when discard cancelled.');

    // Clear note textarea
    await noteTextarea.fill('');

    // Case 3C: Grade Override Sub-Modal Guard
    console.log('Testing Grade Override sub-modal draft protection...');
    const openOverrideBtn = page.locator('[data-testid="open-grade-override-btn"]');
    await openOverrideBtn.click();

    const overrideModal = page.locator('[data-testid="override-modal"]');
    await overrideModal.waitFor({ state: 'visible', timeout: 3000 });

    const overrideRationale = page.locator('[data-testid="override-rationale-input"]');
    await overrideRationale.fill('Medical accommodation pending review');

    // Attempt to cancel override
    dialogTriggered = false;
    page.once('dialog', async dialog => {
      dialogTriggered = true;
      console.log(`[Dialog received on override cancel] ${dialog.message()}`);
      await dialog.dismiss(); // Reject discard
    });
    const cancelOverrideBtn = page.locator('[data-testid="cancel-override-btn"]');
    await cancelOverrideBtn.click();
    await page.waitForTimeout(500);
    if (!dialogTriggered) {
      throw new Error('Expected confirmation dialog when cancelling dirty Grade Override!');
    }
    if (!(await overrideModal.isVisible())) {
      throw new Error('Override modal closed despite dismissing discard confirmation!');
    }

    // Now accept discard on override
    dialogTriggered = false;
    page.once('dialog', async dialog => {
      dialogTriggered = true;
      await dialog.accept();
    });
    await cancelOverrideBtn.click();
    await page.waitForTimeout(500);
    await overrideModal.waitFor({ state: 'hidden', timeout: 3000 });
    console.log('Override modal discarded on user confirmation.');

    // Close profile modal cleanly
    await profileCloseBtn.click();
    await profileModal.waitFor({ state: 'hidden', timeout: 3000 });
    console.log('Profile modal closed cleanly.');

    // =========================================================================
    // TEST 4: Class Creation & Duplication (Units, Policy, Staff, Collisions)
    // =========================================================================
    console.log('\n--- Test 4: Class Creation & Duplication with Database Invariants ---');
    // Navigate to Dashboard
    const navDashboardBtn = page.locator('[data-testid="nav-dashboard-btn"]');
    await navDashboardBtn.click();
    await page.waitForTimeout(800);

    // Open Create Class Modal
    await openCreateBtn.click();
    await createModal.waitFor({ state: 'visible', timeout: 3000 });

    const newCourseCodeInput = page.locator('[data-testid="new-course-code-input"]');
    await newCourseCodeInput.fill('FSF4U');
    await page.locator('input[placeholder="e.g. Grade 12 English"]').fill('Grade 12 Core French');
    await page.locator('input[placeholder="01"]').fill('01');
    await page.locator('input[placeholder="Period 2"]').fill('Period 3');
    await page.locator('input[placeholder="Room 214"]').fill('Room 208');

    // Submit Create Class Form
    await page.locator('button[type="submit"]:has-text("Create & Open")').click();
    await page.waitForTimeout(1500);

    // Verify workspace opened (we are on seating view or layout exists)
    const allSections = await getAllSectionsInIndexedDB(page);
    const createdSection = allSections.find(s => s.sectionNumber === '01' && s.deletedAt === null && s.roomNumber === 'Room 208');
    if (!createdSection) {
      throw new Error('Created section not found in IndexedDB!');
    }
    console.log(`Created section confirmed in IndexedDB: id=${createdSection.id}`);

    // Verify invariants: unit U1, grading policy, seating layout, staff role
    const invariants = await verifySectionEntitiesInIndexedDB(page, createdSection.id);
    console.log('Invariants for created section:', invariants);
    if (!invariants.hasUnit || invariants.unitCode !== 'U1') {
      throw new Error(`Expected Unit U1 to be created, got: ${JSON.stringify(invariants)}`);
    }
    if (!invariants.hasPolicy || invariants.policyWeights?.k !== 25) {
      throw new Error(`Expected default 25/25/25/25 grading policy, got: ${JSON.stringify(invariants)}`);
    }
    if (!invariants.hasLayout || invariants.layoutDims?.rows !== 4 || invariants.layoutDims?.cols !== 5) {
      throw new Error(`Expected 4x5 seating layout, got: ${JSON.stringify(invariants)}`);
    }
    if (!invariants.hasStaff || invariants.staffRole !== 'primary_teacher' || invariants.staffUser !== 'user-tyler') {
      throw new Error(`Expected primary_teacher staff record for user-tyler, got: ${JSON.stringify(invariants)}`);
    }
    console.log('Class creation invariants fully satisfied.');

    // Return to Dashboard to test duplicate
    await navDashboardBtn.click();
    await page.waitForTimeout(800);

    // Duplicate the FSF4U class
    console.log('Duplicating FSF4U class (first copy)...');
    const duplicateBtn = page.locator('[data-testid="duplicate-class-btn"]').first();
    await duplicateBtn.click();
    await page.waitForTimeout(1000);

    const sectionsAfterDup1 = await getAllSectionsInIndexedDB(page);
    const copy1 = sectionsAfterDup1.find(s => s.sectionNumber.includes('-COPY'));
    if (!copy1) {
      throw new Error('First duplicated section not found in IndexedDB!');
    }
    console.log(`Duplicated section 1 created: sectionNumber=${copy1.sectionNumber}`);

    // Verify invariants on copy 1
    const copy1Invariants = await verifySectionEntitiesInIndexedDB(page, copy1.id);
    if (!copy1Invariants.hasUnit || !copy1Invariants.hasPolicy || !copy1Invariants.hasStaff) {
      throw new Error(`Duplicated section 1 missing required invariants: ${JSON.stringify(copy1Invariants)}`);
    }

    // Duplicate AGAIN to test collision resolution (-COPY-2)
    console.log('Duplicating class again (collision resolution check)...');
    await duplicateBtn.click();
    await page.waitForTimeout(1000);

    const sectionsAfterDup2 = await getAllSectionsInIndexedDB(page);
    const copy2 = sectionsAfterDup2.find(s => s.sectionNumber.includes('-COPY-2'));
    if (!copy2) {
      throw new Error(`Expected collision resolution with -COPY-2, found sections: ${JSON.stringify(sectionsAfterDup2.map(s => s.sectionNumber))}`);
    }
    console.log(`Duplicated section 2 created cleanly: sectionNumber=${copy2.sectionNumber}`);

    // =========================================================================
    // TEST 5: Redesigned 2-Column Roster Import, Preview, Confirmation & Safety
    // =========================================================================
    console.log('\n--- Test 5: Redesigned 2-Column Roster Import & Preview Workflow ---');
    const navPortabilityBtn = page.locator('[data-testid="nav-portability-btn"]');
    await navPortabilityBtn.click();
    await page.waitForTimeout(800);

    const csvTextarea = page.locator('[data-testid="roster-csv-textarea"]');
    await csvTextarea.waitFor({ state: 'visible', timeout: 5000 });

    // Step 5A: 2-Column spreadsheet tab-separated paste
    const spreadsheetData = [
      'Tremblay, Jean\tS9901',
      "O'Connor, Patricia\tS9902",
      'Patel, Aarav\tS9903'
    ].join('\n');

    await csvTextarea.fill(spreadsheetData);

    // Click Preview Students
    const previewBtn = page.locator('[data-testid="preview-roster-btn"]');
    await previewBtn.click();

    // Verify preview step displays candidate rows
    const previewStep = page.locator('[data-testid="roster-preview-step"]');
    await previewStep.waitFor({ state: 'visible', timeout: 5000 });
    const previewRows = page.locator('[data-testid="preview-student-row"]');
    const count = await previewRows.count();
    console.log(`Preview displayed ${count} candidate student rows`);
    if (count !== 3) {
      throw new Error(`Expected 3 preview rows, found: ${count}`);
    }

    // Confirm and execute import
    const importBtn = page.locator('[data-testid="import-roster-btn"]');
    await importBtn.click();

    // Verify success confirmation card
    const successEl = page.locator('[data-testid="roster-import-success"]');
    await successEl.waitFor({ state: 'visible', timeout: 5000 });
    const successText = await successEl.textContent();
    console.log('Roster import success card text:', successText);
    if (!successText?.includes('Roster Imported Successfully')) {
      throw new Error(`Expected success message, got: ${successText}`);
    }

    // Verify students in IndexedDB
    const student1 = await verifyStudentInIndexedDB(page, 'S9901');
    console.log('Student 1 in IndexedDB:', student1);
    if (!student1 || student1.lastName !== 'Tremblay') {
      throw new Error(`Spreadsheet name splitting failed! Expected 'Tremblay', got: ${student1?.lastName}`);
    }

    const student2 = await verifyStudentInIndexedDB(page, 'S9902');
    if (!student2 || student2.lastName !== "O'Connor") {
      throw new Error(`Apostrophe name failed! Expected "O'Connor", got: ${student2?.lastName}`);
    }

    // Step 5B: Test Idempotency with Repeat Import
    console.log('Testing idempotency of roster import (re-running same paste)...');
    const addMoreBtn = page.locator('button:has-text("Done / Add More Students")');
    await addMoreBtn.click();
    await csvTextarea.waitFor({ state: 'visible', timeout: 5000 });

    await csvTextarea.fill(spreadsheetData);
    await previewBtn.click();
    await previewStep.waitFor({ state: 'visible', timeout: 5000 });

    // In preview, rows should indicate already in class
    const previewText = await previewStep.textContent();
    if (!previewText?.includes('Already in Class')) {
      throw new Error(`Expected 'Already in Class' warning in preview, got: ${previewText}`);
    }

    await importBtn.click();
    await successEl.waitFor({ state: 'visible', timeout: 5000 });
    const successText2 = await successEl.textContent();
    console.log('Roster repeat import text:', successText2);
    if (!successText2?.includes('3') || !successText2?.includes('Duplicates Skipped')) {
      throw new Error(`Expected duplicates skipped, got: ${successText2}`);
    }

    // Step 5C: Test Blocking Error Protection on Ambiguous Multi-Comma Names
    console.log('Testing blocking error guard on ambiguous multi-comma name...');
    await addMoreBtn.click();
    await csvTextarea.waitFor({ state: 'visible', timeout: 5000 });

    const ambiguousData = 'Smith, Jr., Jordan\tS9904';
    await csvTextarea.fill(ambiguousData);
    await previewBtn.click();
    await previewStep.waitFor({ state: 'visible', timeout: 5000 });

    const previewErrorText = await previewStep.textContent();
    console.log('Preview with ambiguous name:', previewErrorText);
    if (!previewErrorText?.includes('Blocking errors detected') || !previewErrorText?.includes('contains multiple commas')) {
      throw new Error(`Expected blocking error warning for multiple commas, got: ${previewErrorText}`);
    }

    // Import button must be disabled
    const isImportDisabled = await importBtn.isDisabled();
    if (!isImportDisabled) {
      throw new Error('Import button must be disabled when blocking errors exist!');
    }
    console.log('Blocking error guard confirmed: Import button is disabled.');

    // Step 5D: Verify CSV Exporters & Backup buttons exist and are active
    console.log('Verifying CSV export & Backup actions...');
    const editBtn = page.locator('[data-testid="edit-pasted-list-btn"]');
    await editBtn.click();
    await csvTextarea.waitFor({ state: 'visible', timeout: 5000 });

    const markbookExportBtn = page.locator('[data-testid="export-markbook-btn"]');
    const partExportBtn = page.locator('[data-testid="export-participation-btn"]');
    const backupBtn = page.locator('[data-testid="create-backup-btn"]');

    if (!(await markbookExportBtn.isVisible()) || !(await partExportBtn.isVisible()) || !(await backupBtn.isVisible())) {
      throw new Error('Export and Backup action buttons must be visible in modal!');
    }
    console.log('CSV Export and Backup actions verified successfully.');

    // =========================================================================
    // TEST 6: Teacher Selector & Tyler -> Chen Switch Flow (V6.6 Test Isolation)
    // =========================================================================
    console.log('\n--- Test 6: Teacher Selector Lifecycle & Tyler -> Chen Switch Verification (Isolated Context) ---');
    // First close the roster modal if it's still open from step 5
    const closeRosterBtn = page.locator('[data-testid="modal-close-btn"]');
    if (await closeRosterBtn.isVisible()) {
      await closeRosterBtn.click();
      await page.waitForTimeout(300);
    }

    // Step 6A: Create a fresh, isolated browser context specifically for Test 6
    console.log('Creating fresh browser context for Test 6 to prevent cross-test contamination...');
    const test6Context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const test6Page = await test6Context.newPage();

    test6Page.on('pageerror', err => {
      console.error(`[Test 6 PageError] ${err.message}`);
      pageErrors.push(err);
    });
    test6Page.on('console', msg => {
      if (msg.type() === 'error') {
        console.error(`[Test 6 Console Error] ${msg.text()}`);
        pageErrors.push(new Error(msg.text()));
      }
    });

    console.log('Navigating test6Page to app and waiting for original seed state initialization...');
    await test6Page.goto(`http://localhost:${port}`);
    await test6Page.waitForTimeout(2000); // Wait for initial app seed to finish

    // Select initial teacher (Taylor Demo) from original demo seed state
    const initialTeacherModal = test6Page.locator('[data-testid="teacher-selector-modal"]');
    if (await initialTeacherModal.isVisible()) {
      console.log('Selecting Taylor Demo from original seed state...');
      const tylerBtn = test6Page.locator('[data-testid="select-teacher-user-tyler"]');
      if (await tylerBtn.isVisible()) {
        await tylerBtn.click();
      } else {
        await test6Page.locator('[data-testid^="select-teacher-"]').first().click();
      }
      await initialTeacherModal.waitFor({ state: 'hidden', timeout: 5000 });
    }

    // Step 6B: Insert Chen's complete fixture into the test browser database and wait for IndexedDB commit
    console.log('Inserting Teacher Chen complete fixture into browser IndexedDB...');
    const nowIso = new Date().toISOString();
    const todayStr = nowIso.slice(0, 10);

    const fixtureData = {
      user: {
        id: 'teacher-chen',
        authSubject: 'auth0|chen-david',
        email: 'jordan.demo@example.invalid',
        name: 'Jordan Demo',
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        version: 1
      },
      membership: {
        id: 'membership-chen-school',
        organizationId: 'org-school-port-credit',
        userId: 'teacher-chen',
        role: 'teacher',
        status: 'active',
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        version: 1
      },
      course: {
        id: 'course-mcv4u',
        organizationId: 'org-school-port-credit',
        code: 'MCV4U',
        title: 'Grade 12 University Calculus and Vectors',
        department: 'Mathematics',
        gradeLevel: 12,
        creditValue: 1.0,
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        version: 1
      },
      classSection: {
        id: 'class-mcv4u-01',
        courseId: 'course-mcv4u',
        termId: 'term-s1-2026',
        sectionNumber: '01',
        period: 'Period 1 (8:45 - 10:00 AM)',
        roomNumber: 'Room 205',
        colorToken: '#16a34a',
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        version: 1
      },
      staff: {
        id: 'staff-mcv4u-chen',
        classSectionId: 'class-mcv4u-01',
        organizationMembershipId: 'membership-chen-school',
        role: 'primary_teacher',
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        version: 1
      },
      unit: {
        id: 'unit-mcv-1',
        classSectionId: 'class-mcv4u-01',
        code: 'U1',
        title: 'Rates of Change & Derivatives',
        sortOrder: 1,
        startsOn: '2026-09-02',
        endsOn: '2026-10-15',
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        version: 1
      },
      policy: {
        id: 'policy-mcv4u-default',
        classSectionId: 'class-mcv4u-01',
        reportingPeriodId: null,
        scopeKey: 'DEFAULT',
        weightK: 30.0,
        weightT: 30.0,
        weightC: 20.0,
        weightA: 20.0,
        excludeFormative: true,
        missingWorkPolicy: 'exclude',
        defaultMarkScaleVersionId: 'scale-ont-levels-v1',
        decimalPrecision: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        version: 1
      },
      layout: {
        id: 'layout-mcv-main',
        classSectionId: 'class-mcv4u-01',
        name: 'Calculus Room 205 Grid 4x5',
        rows: 4,
        cols: 5,
        isLocked: false,
        cardSize: 'standard',
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        version: 1
      },
      seat: {
        id: 'seat-mcv-0-0',
        seatingLayoutId: 'layout-mcv-main',
        row: 0,
        col: 0,
        classEnrollmentId: 'enroll-mcv-1',
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        version: 1
      },
      enrollment: {
        id: 'enroll-mcv-1',
        classSectionId: 'class-mcv4u-01',
        studentId: 'student-1',
        enrollmentStatus: 'active',
        enrolledDate: '2026-09-02',
        droppedDate: null,
        customDisplayOrder: 1,
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        version: 1
      },
      session: {
        id: 'session-mcv-today',
        classSectionId: 'class-mcv4u-01',
        startsAt: `${todayStr}T08:45:00Z`,
        endsAt: `${todayStr}T10:00:00Z`,
        localSchoolDate: todayStr,
        timezone: 'America/Toronto',
        title: 'Limits & Average Rate of Change',
        sessionType: 'regular',
        createdAt: nowIso,
        updatedAt: nowIso,
        deletedAt: null,
        version: 1
      }
    };

    await test6Page.evaluate(async (data) => {
      return new Promise<void>((resolve, reject) => {
        const req = indexedDB.open('OntarioTeacherAssessmentDB');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const idb = req.result;
          const tx = idb.transaction([
            'users',
            'organizationMemberships',
            'courses',
            'classSections',
            'classSectionStaff',
            'units',
            'gradingPolicies',
            'seatingLayouts',
            'seatPositions',
            'classEnrollments',
            'classSessions'
          ], 'readwrite');

          tx.onerror = () => reject(tx.error);
          tx.oncomplete = () => resolve();

          tx.objectStore('users').put(data.user);
          tx.objectStore('organizationMemberships').put(data.membership);
          tx.objectStore('courses').put(data.course);
          tx.objectStore('classSections').put(data.classSection);
          tx.objectStore('classSectionStaff').put(data.staff);
          tx.objectStore('units').put(data.unit);
          tx.objectStore('gradingPolicies').put(data.policy);
          tx.objectStore('seatingLayouts').put(data.layout);
          tx.objectStore('seatPositions').put(data.seat);
          tx.objectStore('classEnrollments').put(data.enrollment);
          tx.objectStore('classSessions').put(data.session);
        };
      });
    }, fixtureData);
    console.log('Chen test fixture committed to IndexedDB.');

    // Step 6C: Reload page before testing the teacher selector and class list
    console.log('Reloading test6Page to reflect committed fixture...');
    await test6Page.reload();
    await test6Page.waitForTimeout(1000);

    // Verify initial acting teacher is Taylor Demo from original seed state
    const switchTeacherBtn = test6Page.locator('[data-testid="header-teacher-btn"]');
    await switchTeacherBtn.waitFor({ state: 'visible', timeout: 5000 });
    const initialTeacherText = await switchTeacherBtn.innerText();
    console.log('Initial Header teacher button text:', initialTeacherText);
    if (!initialTeacherText.includes('Taylor Demo')) {
      throw new Error(`Expected initial acting teacher to be Taylor Demo, got: ${initialTeacherText}`);
    }

    // Step 6D: Open Teacher Selector Modal
    console.log('Opening teacher selector modal...');
    await switchTeacherBtn.click();

    const teacherSelectorModal = test6Page.locator('[data-testid="teacher-selector-modal"]');
    await teacherSelectorModal.waitFor({ state: 'visible', timeout: 5000 });

    const teacherCloseBtn = test6Page.locator('[data-testid="teacher-selector-close-btn"]');
    const teacherCancelBtn = test6Page.locator('[data-testid="teacher-selector-cancel-btn"]');
    if (!(await teacherCloseBtn.isVisible())) {
      throw new Error('Teacher selector modal must show close button when teacher already selected!');
    }
    if (!(await teacherCancelBtn.isVisible())) {
      throw new Error('Teacher selector modal must show cancel button when teacher already selected!');
    }

    // Verify teacher buttons are enabled (isSubmitting is false)
    const allTeacherBtns = test6Page.locator('[data-testid^="select-teacher-"]');
    const teacherCount = await allTeacherBtns.count();
    if (teacherCount === 0) {
      throw new Error('Expected at least one teacher button in selector modal!');
    }
    for (let i = 0; i < teacherCount; i++) {
      const btn = allTeacherBtns.nth(i);
      if (await btn.isDisabled()) {
        throw new Error(`Teacher button ${i} is unexpectedly disabled! isSubmitting bug detected.`);
      }
    }
    console.log('All teacher buttons are enabled (isSubmitting is false).');

    // Step 6E: Select Teacher Jordan Demo
    console.log('Selecting Teacher Jordan Demo (teacher-chen)...');
    const chenBtn = test6Page.locator('[data-testid="select-teacher-teacher-chen"]');
    await chenBtn.waitFor({ state: 'visible', timeout: 5000 });
    await chenBtn.click();

    // Assert: Modal closes
    await teacherSelectorModal.waitFor({ state: 'hidden', timeout: 5000 });
    console.log('Teacher selector modal closed successfully.');

    // Assert: Header displays Chen
    const chenHeaderBtn = test6Page.locator('[data-testid="header-teacher-btn"]');
    await chenHeaderBtn.waitFor({ state: 'visible', timeout: 5000 });
    const chenHeaderText = await chenHeaderBtn.innerText();
    console.log('Header text after switch to Chen:', chenHeaderText);
    if (!chenHeaderText.includes('Jordan Demo') || !chenHeaderText.includes('JD')) {
      throw new Error(`Expected header to display Jordan Demo and initials DC, got: ${chenHeaderText}`);
    }

    // Assert: Identity and device identify Chen (via standard browser storage & IndexedDB, without window hooks)
    console.log('Verifying active teacher and device identify Chen...');
    const identityCheck = await test6Page.evaluate(async () => {
      const activeUserId = sessionStorage.getItem('ontario_active_user_id');
      const deviceId = localStorage.getItem('ontario_teacher_device_id');
      return new Promise<any>((resolve, reject) => {
        const req = indexedDB.open('OntarioTeacherAssessmentDB');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const idb = req.result;
          const tx = idb.transaction(['devices'], 'readonly');
          const store = tx.objectStore('devices');
          const getReq = store.get(deviceId || '');
          getReq.onsuccess = () => {
            resolve({
              activeUserId,
              deviceId,
              deviceRecord: getReq.result || null
            });
          };
          getReq.onerror = () => reject(getReq.error);
        };
      });
    });
    console.log('Identity and device check:', identityCheck);
    if (identityCheck.activeUserId !== 'teacher-chen') {
      throw new Error(`Expected active user in sessionStorage to be 'teacher-chen', got: ${identityCheck.activeUserId}`);
    }
    if (identityCheck.deviceRecord?.userId !== 'teacher-chen') {
      throw new Error(`Expected device record userId to be 'teacher-chen', got: ${identityCheck.deviceRecord?.userId}`);
    }

    // Step 6F: Switch to Chen's class and perform an authentic UI save through StudentProfileModal
    console.log('Switching to Chen\'s class (MCV4U-01) in header...');
    const classSelect = test6Page.locator('[data-testid="header-class-select"]');
    await classSelect.selectOption('class-mcv4u-01');
    await test6Page.waitForTimeout(600);

    // Switch to Class View (Seating) so seating cards are displayed
    const navSeatingBtn = test6Page.locator('[data-testid="nav-seating-btn"]');
    await navSeatingBtn.waitFor({ state: 'visible', timeout: 5000 });
    await navSeatingBtn.click();
    await test6Page.waitForTimeout(600);

    // Verify the override does not exist before clicking Apply
    const preOverrideCheck = await test6Page.evaluate(async () => {
      return new Promise<any>((resolve, reject) => {
        const req = indexedDB.open('OntarioTeacherAssessmentDB');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const idb = req.result;
          const tx = idb.transaction(['gradeOverrides'], 'readonly');
          const store = tx.objectStore('gradeOverrides');
          const getAllReq = store.getAll();
          getAllReq.onsuccess = () => {
            const matches = (getAllReq.result || []).filter((o: any) => o.classEnrollmentId === 'enroll-mcv-1' && o.deletedAt === null);
            resolve(matches);
          };
          getAllReq.onerror = () => reject(getAllReq.error);
        };
      });
    });
    if (preOverrideCheck.length > 0) {
      throw new Error(`Expected no grade override for enroll-mcv-1 before UI write, but found: ${JSON.stringify(preOverrideCheck)}`);
    }
    console.log('Verified: No grade override exists for enroll-mcv-1 prior to UI save.');

    // Specifically target the fixture enrollment (enroll-mcv-1 for Jordan Avery)
    console.log('Opening student profile for fixture enrollment enroll-mcv-1...');
    const fixtureCard = test6Page.locator('[data-testid="student-seat-card"]').filter({ hasText: 'Jordan Avery' });
    await fixtureCard.waitFor({ state: 'visible', timeout: 5000 });
    const test6OpenProfileBtn = fixtureCard.locator('[data-testid="open-student-profile-btn"]');
    await test6OpenProfileBtn.click();

    const test6ProfileModal = test6Page.locator('[data-testid="student-profile-modal"]');
    await test6ProfileModal.waitFor({ state: 'visible', timeout: 5000 });

    // Open Grade Override sub-modal
    const test6OpenOverrideBtn = test6Page.locator('[data-testid="open-grade-override-btn"]');
    await test6OpenOverrideBtn.waitFor({ state: 'visible', timeout: 5000 });
    await test6OpenOverrideBtn.click();

    const test6OverrideModal = test6Page.locator('[data-testid="override-modal"]');
    await test6OverrideModal.waitFor({ state: 'visible', timeout: 5000 });

    // Fill override form
    const overrideInput = test6Page.locator('[data-testid="override-percentage-input"]');
    await overrideInput.fill('95');
    const rationaleInput = test6Page.locator('[data-testid="override-rationale-input"]');
    await rationaleInput.fill('Grade override submitted through UI by Teacher Jordan Demo');

    // Click Apply (save-override-btn)
    console.log('Submitting grade override via Apply button...');
    const saveOverrideBtn = test6Page.locator('[data-testid="save-override-btn"]');
    await saveOverrideBtn.click();
    await test6OverrideModal.waitFor({ state: 'hidden', timeout: 5000 });

    // Close StudentProfileModal
    const test6ProfileCloseBtn = test6Page.locator('[data-testid="profile-close-btn"]');
    await test6ProfileCloseBtn.click();
    await test6ProfileModal.waitFor({ state: 'hidden', timeout: 5000 });
    console.log('UI save completed through StudentProfileModal.');

    // Verify resulting record, Chen audit entry, and sync mutation directly from IndexedDB
    console.log('Verifying resulting override, audit entry, and sync mutation in IndexedDB...');
    const postWriteVerification = await test6Page.evaluate(async () => {
      return new Promise<any>((resolve, reject) => {
        const req = indexedDB.open('OntarioTeacherAssessmentDB');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const idb = req.result;
          const tx = idb.transaction(['gradeOverrides', 'auditEntries', 'syncMutations'], 'readonly');
          const ovStore = tx.objectStore('gradeOverrides');
          const auStore = tx.objectStore('auditEntries');
          const syStore = tx.objectStore('syncMutations');

          const ovReq = ovStore.getAll();
          ovReq.onsuccess = () => {
            const overrides = (ovReq.result || []).filter((o: any) => o.classEnrollmentId === 'enroll-mcv-1' && o.deletedAt === null);
            const override = overrides[0] || null;
            if (!override) {
              resolve({ override: null, auditEntry: null, syncMutation: null });
              return;
            }

            const auReq = auStore.getAll();
            auReq.onsuccess = () => {
              const auditEntry = (auReq.result || []).find((a: any) => a.entityId === override.id);
              const syReq = syStore.getAll();
              syReq.onsuccess = () => {
                const syncMutation = (syReq.result || []).find((s: any) => s.entityId === override.id);
                resolve({ override, auditEntry, syncMutation });
              };
              syReq.onerror = () => reject(syReq.error);
            };
            auReq.onerror = () => reject(auReq.error);
          };
          ovReq.onerror = () => reject(ovReq.error);
        };
      });
    });

    console.log('Post-write verification:', postWriteVerification);
    if (!postWriteVerification.override || postWriteVerification.override.overridePercentage !== 95) {
      throw new Error(`Expected saved override with percentage 95, got: ${JSON.stringify(postWriteVerification.override)}`);
    }
    if (postWriteVerification.override.teacherUserId !== 'teacher-chen') {
      throw new Error(`Expected override teacherUserId to be 'teacher-chen', got: ${postWriteVerification.override.teacherUserId}`);
    }
    if (!postWriteVerification.auditEntry || postWriteVerification.auditEntry.userId !== 'teacher-chen') {
      throw new Error(`Expected audit entry with userId 'teacher-chen', got: ${JSON.stringify(postWriteVerification.auditEntry)}`);
    }
    if (postWriteVerification.auditEntry.action !== 'INSERT') {
      throw new Error(`Expected audit entry action to be 'INSERT', got: ${postWriteVerification.auditEntry.action}`);
    }
    if (!postWriteVerification.syncMutation || postWriteVerification.syncMutation.deviceId !== identityCheck.deviceId) {
      throw new Error(`Expected sync mutation with deviceId '${identityCheck.deviceId}', got: ${JSON.stringify(postWriteVerification.syncMutation)}`);
    }
    if (postWriteVerification.syncMutation.operation !== 'INSERT') {
      throw new Error(`Expected sync mutation operation to be 'INSERT', got: ${postWriteVerification.syncMutation.operation}`);
    }
    console.log('Chen UI save, audit entry, and sync mutation fully verified.');

    // Step 6G: Switching the viewed class does not change the acting teacher
    console.log('Switching viewed class to ENG4U-01 and verifying acting teacher remains Chen...');
    await classSelect.selectOption('class-eng4u-01');
    await test6Page.waitForTimeout(300);

    const headerTextAfterClassSwitch = await chenHeaderBtn.innerText();
    if (!headerTextAfterClassSwitch.includes('Jordan Demo')) {
      throw new Error(`Acting teacher changed in header after class switch! Header: ${headerTextAfterClassSwitch}`);
    }

    const activeUserAfterClassSwitch = await test6Page.evaluate(() => sessionStorage.getItem('ontario_active_user_id'));
    if (activeUserAfterClassSwitch !== 'teacher-chen') {
      throw new Error(`Expected active user in sessionStorage to remain 'teacher-chen', got: ${activeUserAfterClassSwitch}`);
    }
    console.log('Class switch confirmed: Acting teacher remained stable as Jordan Demo.');

    // Step 6H: Reopening selector and cancelling leaves Chen active
    console.log('Testing reopening selector and cancelling (via Cancel button)...');
    await chenHeaderBtn.click();
    await teacherSelectorModal.waitFor({ state: 'visible', timeout: 5000 });
    await teacherCancelBtn.click();
    await teacherSelectorModal.waitFor({ state: 'hidden', timeout: 5000 });

    const headerTextAfterCancel = await chenHeaderBtn.innerText();
    if (!headerTextAfterCancel.includes('Jordan Demo')) {
      throw new Error(`Acting teacher reverted after cancelling selector! Header: ${headerTextAfterCancel}`);
    }
    console.log('Cancel button leaves Chen active.');

    // Escape key
    console.log('Testing reopening selector and cancelling via Escape key...');
    await chenHeaderBtn.click();
    await teacherSelectorModal.waitFor({ state: 'visible', timeout: 5000 });
    await test6Page.keyboard.press('Escape');
    await teacherSelectorModal.waitFor({ state: 'hidden', timeout: 5000 });
    const activeUserAfterEscape = await test6Page.evaluate(() => sessionStorage.getItem('ontario_active_user_id'));
    if (activeUserAfterEscape !== 'teacher-chen') {
      throw new Error(`Expected active user to remain 'teacher-chen' after Escape, got: ${activeUserAfterEscape}`);
    }
    console.log('Escape key leaves Chen active.');

    // Close button (X)
    console.log('Testing reopening selector and cancelling via Close button (X)...');
    await chenHeaderBtn.click();
    await teacherSelectorModal.waitFor({ state: 'visible', timeout: 5000 });
    await teacherCloseBtn.click();
    await teacherSelectorModal.waitFor({ state: 'hidden', timeout: 5000 });
    const activeUserAfterCloseBtn = await test6Page.evaluate(() => sessionStorage.getItem('ontario_active_user_id'));
    if (activeUserAfterCloseBtn !== 'teacher-chen') {
      throw new Error(`Expected active user to remain 'teacher-chen' after Close button, got: ${activeUserAfterCloseBtn}`);
    }
    console.log('Close button (X) leaves Chen active.');

    await test6Context.close();
    console.log('Test 6 isolated context cleaned up successfully.');

    // Assert zero unhandled browser errors during entire suite
    if (pageErrors.length > 0) {
      throw new Error(`Browser encountered ${pageErrors.length} unhandled error(s): ${pageErrors[0].message}`);
    }

    console.log('\n=============================================================');
    console.log('ALL BROWSER UX & INTEGRATION TESTS PASSED WITH ZERO ERRORS!');
    console.log('=============================================================\n');
  } catch (err: any) {
    console.error('Browser UX Test Failure:', err.message || err);
    runError = err;
    process.exitCode = 1;
  } finally {
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
  console.error('Fatal error in test runner:', err.message || err);
  process.exitCode = 1;
});
