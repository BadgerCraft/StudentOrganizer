import { createServer } from 'vite';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { installFictionalClassroom } from './helpers/classroomFixture';

const stage = process.env.UI_SCREENSHOT_STAGE || 'before';
const directory = `docs/work-orders/evidence/UI-2026-10-27/${stage}`;
await mkdir(directory, { recursive: true });
const server = await createServer({ server: { host: '127.0.0.1', port: 0, watch: null, hmr: false } });
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === 'string') throw new Error('Missing local server');
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin);
  await installFictionalClassroom(page);
  await page.locator('[data-testid^="select-teacher-"]').first().click();
  await page.getByTestId('nav-seating-btn').click();
  await page.getByTestId('student-seat-card').first().waitFor();
  await page.screenshot({ path: `${directory}/class.png`, fullPage: true });
  await page.getByRole('button', { name: stage === 'before' ? 'Assessments' : 'Markbook', exact: true }).click();
  await page.getByTestId('open-marking-' + 'not-a-real-id').count();
  await page.screenshot({ path: `${directory}/assignments.png`, fullPage: true });
  console.log(`Screenshots saved: ${directory}`);
} finally { await browser.close(); await server.close(); }
