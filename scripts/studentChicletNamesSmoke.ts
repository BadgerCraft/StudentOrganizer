import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { installFictionalClassroom } from './helpers/classroomFixture';

// Exercise actual classroom cards with fictional long names, never student files.
const server = await createServer({ cacheDir: join(tmpdir(), `chiclet-name-vite-${process.pid}`), server: { host: '127.0.0.1', port: 0, watch: null, hmr: false } });
await server.listen();
const address = server.httpServer!.address(); assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin) || route.request().url().startsWith('blob:') ? route.continue() : (external.push(route.request().url()), route.abort()));
  await page.goto(origin); await installFictionalClassroom(page);
  const fixture = await page.evaluate(async () => {
    const path = '/src/db/database.ts', { db } = await import(path);
    const layout = await db.seatingLayouts.toCollection().first();
    const seats = await db.seatPositions.where('seatingLayoutId').equals(layout.id).toArray();
    const people = [];
    const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
    canvas.getContext('2d')!.fillRect(0, 0, 16, 16);
    const names = [
      { firstName: 'Alexandria-Catherine', lastName: 'Montgomery-Worthington-Sánchez', preferredName: 'Lexie' },
      { firstName: 'Alexandria'.repeat(10), lastName: 'Worthington'.repeat(9), preferredName: null }
    ];
    for (let index = 0; index < names.length; index++) {
      const enrollment = await db.classEnrollments.get(seats[index].classEnrollmentId);
      await db.students.update(enrollment.studentId, { ...names[index], photoUrl: canvas.toDataURL('image/png') });
      const student = await db.students.get(enrollment.studentId);
      people.push({ ...names[index], id: student.id, enrollmentId: enrollment.id, localStudentNumber: student.localStudentNumber });
    }
    await db.seatingLayouts.update(layout.id, { cols: 12, cardSize: 'compact' });
    return { layoutId: layout.id, seats, people };
  });
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await page.getByTestId('nav-dashboard-btn').click();
  await page.getByTestId('chiclet-open-overlay-btn').first().click();
  await page.getByTestId('classroom-tools-toggle').click();
  await page.getByRole('button', { name: 'Group', exact: true }).click();
  for (const person of fixture.people) {
    const card = page.locator(`[data-enrollment-id="${person.enrollmentId}"]`);
    await card.focus(); await page.keyboard.press('Space');
    assert.equal(await card.getAttribute('aria-pressed'), 'true');
  }
  const results: unknown[] = [];
  for (const cardSize of ['compact', 'standard']) for (const width of [360, 1280]) for (const zoom of [1, 2]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(async ({ layoutId, cardSize, zoom }) => {
      const path = '/src/db/database.ts'; await (await import(path)).db.seatingLayouts.update(layoutId, { cardSize });
      document.documentElement.style.zoom = String(zoom);
    }, { layoutId: fixture.layoutId, cardSize, zoom });
    const expectedMinHeight = cardSize === 'compact' ? 80 : 112;
    await page.waitForFunction(({ id, minHeight }) => {
      const card = document.querySelector(`[data-enrollment-id="${id}"]`);
      return card && parseFloat(getComputedStyle(card).minHeight) === minHeight;
    }, { id: fixture.people[0].enrollmentId, minHeight: expectedMinHeight });
    for (const person of fixture.people) {
      const card = page.locator(`[data-testid="student-seat-card"][data-enrollment-id="${person.enrollmentId}"]`);
      const text = await card.innerText();
      assert.ok(text.includes(`${person.firstName} ${person.lastName}`), 'full actual first and last are visible');
      if (person.preferredName) assert.ok(text.includes(`${person.preferredName} ${person.lastName}`), 'preferred name remains available');
      assert.ok(!text.includes(person.localStudentNumber), 'student number removed only from card display');
      const geometry = await card.evaluate(node => {
        const bounds = node.getBoundingClientRect();
        const names = Array.from(node.querySelectorAll<HTMLElement>('[data-testid="student-seat-name"],[data-testid="student-seat-full-name"]'));
        const actions = node.querySelector<HTMLElement>('.seat-card-actions')!;
        const actionBounds = actions.getBoundingClientRect();
        return {
          card: { width: bounds.width, height: bounds.height },
          names: names.map(name => {
            const rect = name.getBoundingClientRect(), style = getComputedStyle(name);
            return { fits: name.scrollWidth <= name.clientWidth + 1 && name.scrollHeight <= name.clientHeight + 1, inside: rect.left >= bounds.left && rect.right <= bounds.right + 1 && rect.bottom <= bounds.bottom, noEllipsis: style.textOverflow !== 'ellipsis' && style.whiteSpace !== 'nowrap', readable: parseFloat(style.fontSize) >= 14, beforeActions: rect.bottom <= actionBounds.top + 1 };
          }),
          actionsFit: Array.from(actions.querySelectorAll('button')).every(button => {
            const rect = button.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && rect.left >= bounds.left && rect.right <= bounds.right + 1 && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
          }),
          photoVisible: !!node.querySelector('img')?.getBoundingClientRect().width
        };
      });
      assert.ok(geometry.names.every(name => name.fits && name.inside && name.noEllipsis && name.readable && name.beforeActions), JSON.stringify({ cardSize, width, zoom, geometry }));
      assert.ok(geometry.actionsFit && geometry.photoVisible, 'photo and quick actions remain inside the card');
      results.push({ cardSize, width, zoom, geometry });
    }
    const firstBounds = await page.locator(`[data-enrollment-id="${fixture.people[0].enrollmentId}"]`).boundingBox();
    const secondBounds = await page.locator(`[data-enrollment-id="${fixture.people[1].enrollmentId}"]`).boundingBox();
    assert.ok(firstBounds && secondBounds && firstBounds.x + firstBounds.width + 1 < secondBounds.x, 'selected neighboring cards retain a visible gap');
    await page.getByTestId('seating-scroll').evaluate(node => { node.scrollLeft = 0; });
    const scroll = await page.getByTestId('seating-scroll').evaluate(node => ({ scrollable: node.scrollWidth > node.clientWidth, origin: node.scrollLeft }));
    assert.ok(scroll.scrollable, 'dense twelve-column layout scrolls instead of squeezing name text');
    assert.equal(scroll.origin, 0, 'leftmost seat remains reachable at scroll origin');
  }
  await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const first = page.locator(`[data-enrollment-id="${fixture.people[0].enrollmentId}"]`);
  await first.getByTestId('open-student-profile-btn').click();
  const profile = page.getByTestId('student-profile-modal'); await profile.waitFor();
  assert.ok((await profile.innerText()).includes(`#${fixture.people[0].localStudentNumber}`), 'student number is still in full profile');
  await page.keyboard.press('Escape');
  const after = await page.evaluate(async layoutId => { const path = '/src/db/database.ts'; return (await import(path)).db.seatPositions.where('seatingLayoutId').equals(layoutId).toArray(); }, fixture.layoutId);
  assert.deepEqual(after, fixture.seats, 'display changes never alter seat assignments');
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await page.screenshot({ path: join(tmpdir(), 'student-chiclet-names.png') });
  await writeFile(join(tmpdir(), 'student-chiclet-names-results.json'), JSON.stringify({ status: 'pass', deviceScaleFactor: 2, scenarios: results, unchangedSeats: true, numberRetainedInProfile: true }, null, 2));
  console.log('PASS: full/preferred/long/hyphenated names, compact/standard, narrow/desktop, DPR2 and 200% CSS zoom, readable wrapping, visible photo/actions, dense scrolling, unchanged seats and profile student number');
} finally { await browser.close(); await server.close(); }
