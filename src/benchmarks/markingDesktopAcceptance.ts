import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { zipSync, strToU8 } from 'fflate';
import type { Page, Request } from 'playwright';

/** The caller owns launch/profile isolation and the platform's real download destination. */
export type MarkingDownload = (trigger: () => Promise<void>, destination: string) => Promise<void>;
export interface MarkingDesktopEvidence {
  assessmentId: string;
  assessmentTitle: string;
  firstAttemptId: string;
  secondAttemptId: string;
  pendingFeedback: string;
  reportPath: string;
  backupPath: string;
  snapshots: Record<string, any[]>;
  checks: string[];
}

async function records(page: Page, table: string): Promise<any[]> {
  return page.evaluate(table => new Promise<any[]>((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction(table, 'readonly');
      const read = transaction.objectStore(table).getAll();
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
      transaction.oncomplete = () => db.close();
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  }), table);
}
async function eventually<T>(page: Page, read: () => Promise<T | undefined>, message: string): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (value !== undefined) return value;
    await page.waitForTimeout(100);
  }
  throw new Error(message);
}
/** The document node is reused across students; mounted alone does not mean navigation finished. */
async function openDraft(page: Page, attemptId: string, expectedText: string) {
  await page.getByTestId(`marking-session-open-${attemptId}`).click();
  await eventually(page, async () => {
    const document = page.getByTestId('marking-document');
    const save = page.getByRole('button', { name: 'Save now', exact: true });
    const session = page.locator('section[aria-label="Marking session"]');
    if (!(await document.count()) || !(await save.count()) || !(await session.count())) return undefined;
    return (await document.innerText()).includes(expectedText)
      && (await session.innerText()).includes('Draft — official marks unchanged')
      && await save.isEnabled() ? true : undefined;
  }, `Draft workspace did not settle for ${attemptId}`);
}
async function selectPassage(page: Page, start: number, end: number) {
  await page.getByTestId('marking-document').evaluate((root, offsets) => {
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null, offset = 0, begin: [Node, number] | null = null, finish: [Node, number] | null = null;
    while ((node = walk.nextNode())) {
      const limit = offset + (node.textContent?.length || 0);
      if (!begin && offsets.start < limit) begin = [node, offsets.start - offset];
      if (offsets.end <= limit) { finish = [node, offsets.end - offset]; break; }
      offset = limit;
    }
    if (!begin || !finish) throw new Error('Invalid fictional passage selection');
    const range = document.createRange(); range.setStart(...begin); range.setEnd(...finish);
    const selected = getSelection()!; selected.removeAllRanges(); selected.addRange(range);
    root.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  }, { start, end });
}
async function snapshot(page: Page, assessmentId: string): Promise<Record<string, any[]>> {
  const data: Record<string, any[]> = {};
  for (const table of ['markingAttempts', 'markingSessions', 'markingRubrics', 'markingCommits', 'studentAssessments']) {
    data[table] = (await records(page, table)).filter(row => row.assessmentId === assessmentId).sort((a, b) => a.id.localeCompare(b.id));
  }
  const studentAssessmentIds = new Set(data.studentAssessments.map(row => row.id));
  data.categoryResults = (await records(page, 'categoryResults')).filter(row => studentAssessmentIds.has(row.studentAssessmentId)).sort((a, b) => a.id.localeCompare(b.id));
  return data;
}
const defaultDownload = (page: Page): MarkingDownload => async (trigger, destination) => {
  const pending = page.waitForEvent('download', { timeout: 30000 });
  await trigger();
  const download = await pending;
  await download.saveAs(destination);
  assert.equal(await download.failure(), null, 'Packaged renderer download must complete');
};

/** Run only against a disposable fictional QA profile, with its Assessment Hub already visible. */
async function runAcceptance(page: Page, artifactsDir: string, download: MarkingDownload): Promise<MarkingDesktopEvidence> {
  await fs.mkdir(artifactsDir, { recursive: true });
  const assessmentTitle = `QA Fictional Desktop Markinator ${Date.now()}`;
  await page.getByRole('button', { name: 'New Assessment', exact: true }).click();
  await page.getByPlaceholder('e.g. Comparative Synthesis Essay').fill(assessmentTitle);
  await page.getByRole('button', { name: 'Create Assessment', exact: true }).click();
  const assessment = await eventually(page, async () => (await records(page, 'assessments')).find(row => row.title === assessmentTitle), 'Markinator assessment not saved');
  const beforeOfficial = await snapshot(page, assessment.id);
  await page.getByTestId(`open-marking-${assessment.id}`).click();
  await page.getByRole('button', { name: 'Rubric editor', exact: true }).click();
  await page.getByLabel('Paste rubric text or table').fill('Criterion\tLevel 1\tLevel 2\tLevel 3\tLevel 4\nEvidence\tLimited reasoning\tSome reasoning\tClear reasoning\tThorough reasoning');
  await page.getByRole('button', { name: 'Preview pasted rubric' }).click();
  await page.getByLabel('Rubric title', { exact: true }).fill('Fictional packaged descriptor rubric');
  await page.getByLabel('Criterion 1 KTAC mapping').selectOption('T');
  await page.getByRole('checkbox', { name: /reviewed the descriptor matrix/ }).check();
  await page.getByRole('button', { name: 'Save confirmed rubric version' }).click();

  const text = 'Echo phrase. Middle words. Echo phrase. End. <img src="https://fictional.invalid/essay">';
  const docx = Buffer.from(zipSync({
    '[Content_Types].xml': strToU8('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'),
    '_rels/.rels': strToU8('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'),
    'word/document.xml': strToU8('<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Second fictional essay. Evidence matters.</w:t></w:r></w:p></w:body></w:document>')
  }));
  const inputFiles = [
    { name: 'Fictional-desktop-one.txt', mimeType: 'text/plain', buffer: Buffer.from(text) },
    { name: 'Fictional-desktop-two.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: docx }
  ];
  await page.getByTestId('marking-files').setInputFiles(inputFiles);
  const firstChoice = page.getByLabel(`Confirm student for ${inputFiles[0].name}`);
  await firstChoice.waitFor();
  const students = await firstChoice.locator('option').evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value).filter(Boolean));
  assert.ok(students.length >= 2, 'Fictional package QA requires two enrolled students');
  await firstChoice.selectOption(students[0]);
  await page.getByLabel(`Confirm student for ${inputFiles[1].name}`).selectOption(students[1]);
  await page.getByTestId('marking-import-confirm').click();
  const attempts = await eventually(page, async () => {
    const rows = (await records(page, 'markingAttempts')).filter(row => row.assessmentId === assessment.id);
    return rows.length === 2 ? rows : undefined;
  }, 'Both packaged imports must be persisted');
  const first = attempts.find(row => row.classEnrollmentId === students[0]);
  const second = attempts.find(row => row.classEnrollmentId === students[1]);
  assert.ok(first && second);
  for (const [attempt, file] of [[first, inputFiles[0]], [second, inputFiles[1]]] as const) {
    const original = attempt.documents[0].original;
    assert.ok(original, 'Actual imported original must be retained');
    assert.deepEqual(Buffer.from(original.base64, 'base64'), file.buffer);
    assert.equal(original.hash, createHash('sha256').update(file.buffer).digest('hex'));
  }
  assert.match(second.documents[0].text, /Second fictional essay/);
  await openDraft(page, second.id, 'Second fictional essay.');
  assert.match(await page.getByTestId('marking-document').innerText(), /Second fictional essay/);
  assert.equal(await page.getByTestId('marking-feedback').count(), 0, 'DOCX student must have no TXT pending feedback');
  await openDraft(page, first.id, 'Echo phrase. Middle words.');
  await selectPassage(page, 27, 38);
  await page.getByTestId('marking-feedback').fill('Packaged feedback on repeated passage');
  await page.getByLabel('Evidence level (optional)').selectOption('Level 3');
  await page.getByTestId('marking-comment-save').click();
  await page.getByRole('checkbox', { name: 'Assess T', exact: true }).check();
  await page.getByRole('combobox', { name: 'Official T judgment', exact: true }).selectOption('3+');
  await page.getByLabel('Category T feedback').fill('Use relevant evidence.');
  const officialFeedback = 'Fictional packaged summary <script>literal text</script>.';
  await page.getByLabel('Overall student-facing feedback').fill(officialFeedback);
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  assert.deepEqual((await snapshot(page, assessment.id)).studentAssessments, beforeOfficial.studentAssessments, 'Draft must not change official marks');
  await page.getByTestId('marking-finalize-preview').click();
  await page.getByTestId('marking-finalize-confirm').click();
  await page.getByText('Finalized revision — current official results shown below', { exact: false }).waitFor();
  const finalized = await snapshot(page, assessment.id);
  const official = finalized.studentAssessments.find(row => row.classEnrollmentId === students[0]);
  assert.equal(official.overallFeedback, officialFeedback);
  const category = finalized.categoryResults.filter(row => row.studentAssessmentId === official.id);
  assert.equal(category.length, 1); assert.equal(category[0].rawScore, '3+');
  const reportPath = path.join(artifactsDir, 'markinator-report.html');
  await download(() => page.getByRole('dialog', { name: 'Assessment marking' }).getByRole('button', { name: /^Report / }).first().click(), reportPath);
  const report = await fs.readFile(reportPath, 'utf8');
  assert.match(report, /Fictional packaged summary &lt;script&gt;literal text&lt;\/script&gt;/);
  assert.doesNotMatch(report, /<script\b|<img\b|<iframe\b/i);

  // A revision with an unfinished annotation must survive a real process restart.
  await openDraft(page, first.id, 'Echo phrase. Middle words.');
  await page.getByLabel('Overall student-facing feedback').fill('Fictional pending desktop revision');
  await selectPassage(page, 0, 4);
  const pendingFeedback = 'Fictional unfinished feedback survives desktop restart';
  await page.getByTestId('marking-feedback').fill(pendingFeedback);
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await eventually(page, async () => {
    const rows = (await records(page, 'markingSessions')).filter(row => row.attemptId === first.id);
    return rows.some(row => row.status === 'draft' && row.draft.pending?.text === pendingFeedback) ? true : undefined;
  }, 'Pending feedback not saved');
  const snapshots = await snapshot(page, assessment.id);
  assert.deepEqual(snapshots.studentAssessments, finalized.studentAssessments);
  assert.deepEqual(snapshots.categoryResults, finalized.categoryResults);
  await page.screenshot({ path: path.join(artifactsDir, 'markinator-pending.png'), fullPage: true });
  await page.getByRole('button', { name: 'Back to Organizer', exact: true }).click();
  await page.getByTestId('nav-portability-btn').click();
  const backupPath = path.join(artifactsDir, 'markinator-backup.json');
  await download(() => page.getByTestId('create-backup-btn').click(), backupPath);
  const backup = JSON.parse(await fs.readFile(backupPath, 'utf8'));
  assert.equal(backup.schemaVersion, 4);
  for (const [table, rows] of Object.entries(snapshots)) {
    const ids = new Set(rows.map(row => row.id));
    assert.deepEqual(backup.tables[table].filter((row: any) => ids.has(row.id)).sort((a: any, b: any) => a.id.localeCompare(b.id)), rows, `Full backup must preserve ${table}`);
  }
  // Prove a real restore replaces a subsequent visible edit, rather than merely reading JSON.
  await page.getByTestId('nav-dashboard-btn').click();
  await page.getByTestId('chiclet-open-overlay-btn').first().click();
  await page.locator('button[title="Manage Assessments & Rubrics"]').click();
  await page.getByTestId(`open-marking-${assessment.id}`).click();
  await openDraft(page, first.id, 'Echo phrase. Middle words.');
  await page.getByTestId('marking-feedback').fill('Fictional post-backup change to discard');
  await page.getByRole('button', { name: 'Save now', exact: true }).click();
  await eventually(page, async () => {
    const rows = (await records(page, 'markingSessions')).filter(row => row.attemptId === first.id);
    return rows.some(row => row.draft.pending?.text === 'Fictional post-backup change to discard') ? true : undefined;
  }, 'Post-backup fictional edit not persisted');
  const changed = await snapshot(page, assessment.id);
  await page.getByRole('button', { name: 'Back to Organizer', exact: true }).click();
  await page.getByTestId('nav-portability-btn').click();
  await page.getByTestId('restore-file-input').setInputFiles(backupPath);
  await page.getByTestId('restore-confirm-dialog').waitFor();
  assert.deepEqual(await snapshot(page, assessment.id), changed, 'Restore preview must leave edits intact');
  await page.getByTestId('confirm-restore-btn').click();
  await page.getByText(/Database successfully restored/).waitFor();
  assert.deepEqual(await snapshot(page, assessment.id), snapshots, 'Confirmed actual backup restore must recover marking originals, pending revision and official records');
  return { assessmentId: assessment.id, assessmentTitle, firstAttemptId: first.id, secondAttemptId: second.id, pendingFeedback, reportPath, backupPath, snapshots,
    checks: ['visible rubric/import/finalization UI', 'TXT and DOCX original bytes and hashes', 'draft leaves official marks unchanged', 'finalized KTAC/feedback', 'real inert HTML report download', 'real full backup with marking records', 'saved pending revision', 'actual full backup preview and confirmed restore replaces later edit'] };
}

/** Caller must relaunch the same disposable profile and reopen its Assessment Hub first. */
async function verifyRestart(page: Page, evidence: MarkingDesktopEvidence): Promise<void> {
  await page.getByRole('heading', { name: evidence.assessmentTitle, exact: true }).waitFor();
  assert.deepEqual(await snapshot(page, evidence.assessmentId), evidence.snapshots, 'Actual process restart must preserve originals, rubric, sessions, pending feedback and official records');
  await page.getByTestId(`open-marking-${evidence.assessmentId}`).click();
  await openDraft(page, evidence.secondAttemptId, 'Second fictional essay.');
  assert.match(await page.getByTestId('marking-document').innerText(), /Second fictional essay/);
  await openDraft(page, evidence.firstAttemptId, 'Echo phrase. Middle words.');
  await page.getByTestId('marking-feedback').waitFor();
  assert.equal(await page.getByTestId('marking-feedback').inputValue(), evidence.pendingFeedback);
  assert.equal(await page.getByLabel('Overall student-facing feedback').inputValue(), 'Fictional pending desktop revision');
  assert.ok(await page.getByTestId('marking-document').locator('mark').count() > 0, 'Saved annotation must render after restart');
  await page.screenshot({ path: path.join(path.dirname(evidence.backupPath), 'markinator-restarted.png'), fullPage: true });
  await page.getByRole('button', { name: 'Back to Organizer', exact: true }).click();
  evidence.checks.push('actual process restart and visible pending/annotation recovery');
}

// Observe attempts (including blocked requests), not only successful responses.
function observeLocalRequests(page: Page) {
  const external: string[] = [];
  const observe = (request: Request) => {
    const url = request.url();
    if (!/^(file|data|blob):/i.test(url)) external.push(url);
  };
  page.on('request', observe);
  return () => {
    page.off('request', observe);
    assert.deepEqual(external, [], 'Packaged marking must not attempt external network requests');
  };
}

export async function runMarkingDesktopAcceptance(page: Page, artifactsDir: string, download = defaultDownload(page)): Promise<MarkingDesktopEvidence> {
  const finish = observeLocalRequests(page);
  try {
    const evidence = await runAcceptance(page, artifactsDir, download);
    evidence.checks.push('zero external request attempts during marking and backup/restore');
    return evidence;
  } finally { finish(); }
}

export async function verifyAfterRestart(page: Page, evidence: MarkingDesktopEvidence): Promise<void> {
  const finish = observeLocalRequests(page);
  try {
    await verifyRestart(page, evidence);
    evidence.checks.push('zero external request attempts during recovered document rendering');
  } finally { finish(); }
}
