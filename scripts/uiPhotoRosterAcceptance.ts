import assert from 'node:assert/strict';
import type { Page } from 'playwright';

async function rows(page: Page, table: string): Promise<any[]> {
  return page.evaluate(table => new Promise<any[]>((resolve, reject) => {
    const request = indexedDB.open('OntarioTeacherAssessmentDB');
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(table, 'readonly');
      const read = transaction.objectStore(table).getAll();
      read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error);
      transaction.oncomplete = () => database.close();
    };
  }), table);
}
async function snapshot(page: Page, tables: string[]): Promise<Record<string, any[]>> {
  return Object.fromEntries(await Promise.all(tables.map(async table => [table, await rows(page, table)])));
}

/** Actual controls with generated fictional raster input; IndexedDB access observes only. */
export async function runUiPhotoRosterAcceptance(page: Page): Promise<void> {
  await page.getByTestId('chiclet-open-overlay-btn').first().click();
  const firstCard = page.getByTestId('student-seat-card').first();
  await firstCard.waitFor();
  const displayName = await firstCard.getByTestId('student-seat-name').innerText();
  const originalStudent = (await rows(page, 'students')).find(student => `${student.preferredName || student.firstName} ${student.lastName}` === displayName.trim());
  assert.ok(originalStudent, 'visible fictional student exists');
  const card = page.getByTestId('student-seat-card').filter({ has: page.getByTestId('student-seat-name').filter({ hasText: displayName.trim() }) });
  const imageBase64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 320;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#a71932'; context.fillRect(0, 0, 320, 320);
    context.fillStyle = '#24789b'; context.fillRect(320, 0, 320, 320);
    context.fillStyle = '#ffffff'; context.fillRect(200, 70, 140, 180);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  const fictionalFile = { name: 'fictional-crop-shapes.png', mimeType: 'image/png', buffer: Buffer.from(imageBase64, 'base64') };
  const currentStudent = async () => (await rows(page, 'students')).find(student => student.id === originalStudent.id);
  await card.getByTestId('student-settings-gear-btn').click();
  await page.getByTestId('student-photo-file-input').setInputFiles(fictionalFile);
  await page.getByTestId('apply-photo-crop-btn').waitFor();
  await page.getByTestId('cancel-photo-crop-btn').click();
  assert.deepEqual(await currentStudent(), originalStudent, 'crop cancel leaves stored student unchanged');
  await page.getByTestId('student-photo-file-input').setInputFiles(fictionalFile);
  await page.getByTestId('apply-photo-crop-btn').waitFor();
  const centrePreview = await page.getByLabel('Cropped student photo preview').evaluate(canvas => (canvas as HTMLCanvasElement).toDataURL());
  await page.getByTestId('photo-crop-zoom').focus();
  await page.getByTestId('photo-crop-zoom').press('End');
  await page.getByTestId('photo-crop-horizontal').focus();
  await page.getByTestId('photo-crop-horizontal').press('End');
  await page.getByTestId('photo-crop-vertical').focus();
  await page.getByTestId('photo-crop-vertical').press('Home');
  await page.waitForFunction(before => document.querySelector<HTMLCanvasElement>('[aria-label="Cropped student photo preview"]')?.toDataURL() !== before, centrePreview);
  assert.deepEqual(await currentStudent(), originalStudent, 'zoom/reposition preview does not persist');
  await page.getByTestId('apply-photo-crop-btn').click();
  assert.deepEqual(await currentStudent(), originalStudent, 'Apply Crop remains a draft until Save Changes');
  page.once('dialog', dialog => dialog.accept());
  await page.getByTestId('cancel-student-settings-btn').click();
  await page.getByTestId('student-settings-modal').waitFor({ state: 'hidden' });
  assert.deepEqual(await currentStudent(), originalStudent, 'discarding applied draft preserves original photo');
  await card.getByTestId('student-settings-gear-btn').click();
  await page.getByTestId('student-photo-file-input').setInputFiles(fictionalFile);
  await page.getByTestId('apply-photo-crop-btn').waitFor();
  await page.getByTestId('apply-photo-crop-btn').click();
  await page.getByTestId('save-student-settings-btn').click();
  await page.getByTestId('student-settings-modal').waitFor({ state: 'hidden' });
  const saved = await currentStudent();
  assert.match(saved.photoUrl, /^data:image\/jpeg;base64,/);
  assert.ok(saved.photoUrl.length <= 64 * 1024, 'stored crop obeys photo budget');
  assert.equal(saved.version, originalStudent.version + 1);
  const dimensions = await page.evaluate(source => new Promise<number[]>((resolve, reject) => {
    const image = new Image(); image.onload = () => resolve([image.naturalWidth, image.naturalHeight]); image.onerror = reject; image.src = source;
  }), saved.photoUrl);
  assert.deepEqual(dimensions, [256, 256]);
  await card.getByTestId('student-settings-gear-btn').click();
  await page.getByTestId('edit-photo-crop-btn').click();
  await page.getByTestId('photo-crop-zoom').press('End');
  // Hold a replacement read while the existing crop is open, then cancel.
  // Finishing that read must not reopen a crop or replace the stored photo.
  await page.evaluate(() => {
    const original = FileReader.prototype.readAsDataURL;
    FileReader.prototype.readAsDataURL = function(file) {
      const reader = this;
      (window as any).__finishFictionalPhotoRead = () => new Promise<void>(resolve => {
        reader.addEventListener('loadend', () => resolve(), { once: true });
        FileReader.prototype.readAsDataURL = original;
        original.call(reader, file);
      });
    };
  });
  await page.getByTestId('student-photo-file-input').setInputFiles(fictionalFile);
  await page.getByTestId('cancel-photo-crop-btn').click();
  await page.evaluate(async () => {
    await (window as any).__finishFictionalPhotoRead();
    delete (window as any).__finishFictionalPhotoRead;
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  assert.equal(await page.getByTestId('photo-crop-editor').count(), 0, 'cancel invalidates delayed replacement read');
  assert.deepEqual(await currentStudent(), saved);
  await page.getByTestId('cancel-student-settings-btn').click();
  await page.getByTestId('student-settings-modal').waitFor({ state: 'hidden' });
  assert.deepEqual(await currentStudent(), saved, 'recrop cancellation retains exact previously saved crop');

  const preserved = ['students', 'studentAssessments', 'categoryResults', 'attendanceRecords', 'participationEvents', 'studentNotes', 'gradeOverrides'];
  const beforeRemoval = await snapshot(page, preserved);
  const enrollments = await rows(page, 'classEnrollments');
  const seats = await rows(page, 'seatPositions');
  const auditsBefore = await rows(page, 'auditEntries');
  const outboxBefore = await rows(page, 'syncMutations');
  await card.getByTestId('open-student-profile-btn').click();
  await page.getByTestId('remove-from-class-btn').click();
  await page.getByTestId('cancel-remove-from-class-btn').click();
  assert.deepEqual(await rows(page, 'classEnrollments'), enrollments, 'cancel roster removal keeps membership');
  assert.deepEqual(await rows(page, 'seatPositions'), seats, 'cancel roster removal keeps seats');
  assert.deepEqual(await rows(page, 'auditEntries'), auditsBefore);
  assert.deepEqual(await rows(page, 'syncMutations'), outboxBefore);
  await page.getByTestId('remove-from-class-btn').click();
  await page.getByTestId('confirm-remove-from-class-btn').click();
  await page.getByTestId('confirm-remove-from-class-btn').waitFor({ state: 'hidden' });
  await card.waitFor({ state: 'hidden' });
  const dropped = (await rows(page, 'classEnrollments')).filter(enrollment => enrollment.studentId === saved.id && enrollment.enrollmentStatus === 'dropped');
  assert.equal(dropped.length, 1, 'only the current class membership is dropped');
  assert.deepEqual(await snapshot(page, preserved), beforeRemoval, 'student, official grades, attendance and history remain byte-for-byte unchanged');
  const changedEnrollments = await rows(page, 'classEnrollments');
  for (const enrollment of enrollments.filter(row => row.id !== dropped[0].id)) assert.deepEqual(changedEnrollments.find(row => row.id === enrollment.id), enrollment);
  const currentSeats = await rows(page, 'seatPositions');
  assert.ok(currentSeats.filter(seat => seat.classEnrollmentId === dropped[0].id).every(seat => seat.deletedAt !== null));
  const audits = (await rows(page, 'auditEntries')).filter(row => !auditsBefore.some(old => old.id === row.id));
  assert.ok(audits.some(row => row.entityName === 'classEnrollments' && row.entityId === dropped[0].id));
  assert.equal(new Set(audits.map(row => row.transactionId)).size, 1);
  assert.ok((await rows(page, 'syncMutations')).some(row => row.transactionId === audits[0].transactionId));
  console.log('PASS: QA07 local photo crop/zoom/reposition, cancel/apply/save boundaries, exact stored-photo preservation; QA06 cancel-safe active roster removal retains students, grades, attendance/history and grouped audit/outbox.');
}
