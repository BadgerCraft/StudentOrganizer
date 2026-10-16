import { preview } from 'vite';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

// Exercise the production build with disposable fictional profiles.
const server = process.env.TEACHER_PROFILE_SMOKE_URL ? null : await preview({ preview: { host: '127.0.0.1', port: 4210, strictPort: true } });
const origin = process.env.TEACHER_PROFILE_SMOKE_URL || 'http://127.0.0.1:4210';
const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || '/usr/bin/chromium' });
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors: string[] = [], external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => {
    if (!route.request().url().startsWith(origin)) { external.push(route.request().url()); return route.abort(); }
    return route.continue();
  });
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Enter Teacher here', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Teacher name', { exact: true }).getAttribute('placeholder'), 'Enter Teacher here');
  assert.equal(await page.locator('#app-workspace').getAttribute('inert'), '');
  await page.getByLabel('Teacher name', { exact: true }).fill('Avery Fictional');
  await page.getByRole('button', { name: 'Save and use teacher', exact: true }).click();
  await page.getByTestId('teacher-selector-modal').waitFor({ state: 'hidden' });
  assert.match(await page.getByTestId('header-teacher-btn').innerText(), /Avery Fictional/);
  await page.getByTestId('header-teacher-btn').click();
  await page.getByRole('button', { name: 'Add another teacher', exact: true }).click();
  await page.getByLabel('Teacher name', { exact: true }).fill('Blair Fictional');
  await page.getByLabel('Email (optional)', { exact: true }).fill('blair@example.invalid');
  await page.getByRole('button', { name: 'Save and use teacher', exact: true }).click();
  await page.getByTestId('teacher-selector-modal').waitFor({ state: 'hidden' });
  assert.match(await page.getByTestId('header-teacher-btn').innerText(), /Blair Fictional/);
  await page.getByTestId('header-teacher-btn').click();
  await page.getByRole('button', { name: 'Choose and edit Avery Fictional', exact: true }).click();
  await page.getByRole('heading', { name: 'Edit teacher profile', exact: true }).waitFor();
  await page.getByLabel('Teacher name', { exact: true }).fill('Avery Updated');
  await page.getByRole('button', { name: 'Save and use teacher', exact: true }).click();
  await page.getByTestId('teacher-selector-modal').waitFor({ state: 'hidden' });
  assert.match(await page.getByTestId('header-teacher-btn').innerText(), /Avery Updated/);
  await page.reload();
  assert.match(await page.getByTestId('header-teacher-btn').innerText(), /Avery Updated/);
  // Simulate a new app session while retaining the persistent IndexedDB profiles.
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await page.getByTestId('teacher-selector-modal').waitFor();
  await page.locator('[data-testid^="select-teacher-"]').first().waitFor();
  assert.equal(await page.locator('[data-testid^="select-teacher-"]').count(), 2);
  assert.equal(await page.getByText('Avery Updated', { exact: true }).count(), 1);
  await page.locator('[data-testid^="select-teacher-"]').filter({ hasText: 'Blair Fictional' }).click();
  await page.getByTestId('teacher-selector-modal').waitFor({ state: 'hidden' });
  assert.match(await page.getByTestId('header-teacher-btn').innerText(), /Blair Fictional/);
  // Escape cancels an uncommitted switch and restores the previous actor.
  await page.getByTestId('header-teacher-btn').click();
  await page.getByTestId('teacher-selector-modal').waitFor();
  await page.keyboard.press('Escape');
  await page.getByTestId('teacher-selector-modal').waitFor({ state: 'hidden' });
  assert.match(await page.getByTestId('header-teacher-btn').innerText(), /Blair Fictional/);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('PASS: browser fresh setup, second teacher, explicit choose/edit/switch, reload persistence, new-session confirmation, Escape cancellation, modal isolation; no page errors or external requests.');
} finally { await browser.close(); if (server) await new Promise<void>(resolve => server.httpServer!.close(() => resolve())); }
