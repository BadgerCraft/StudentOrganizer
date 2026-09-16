import { createServer } from 'vite';
import { chromium } from 'playwright';

async function main() {
  console.log('Starting Vite server on port 5199...');
  const server = await createServer({
    server: { port: 5199, strictPort: true },
    logLevel: 'error'
  });
  await server.listen();
  console.log('Vite server listening at http://localhost:5199');

  console.log('Launching Playwright Chromium (headless)...');
  const browser = await chromium.launch({
    headless: true
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('console', msg => {
    console.log(`[Browser] ${msg.text()}`);
  });

  page.on('pageerror', err => {
    console.error(`[Browser PageError]`, err);
  });

  let allPassed = false;
  try {
    console.log('Navigating to benchmark harness http://localhost:5199/benchmark.html ...');
    await page.goto('http://localhost:5199/benchmark.html');

    console.log('Awaiting benchmark completion (360s timeout)...');
    await page.waitForFunction(
      () => (window as any).__BENCHMARK_RESULTS__ !== undefined,
      null,
      { timeout: 360000, polling: 1000 }
    );

    const results = await page.evaluate(() => (window as any).__BENCHMARK_RESULTS__);
    console.log('\n===============================================================');
    console.log('PLAYWRIGHT BROWSER BENCHMARK EXECUTION COMPLETE:');
    console.log('Status: ' + (results.allPassed ? 'ALL PASSED [PASS]' : 'ONE OR MORE FAILED [FAIL]'));
    console.log('===============================================================');
    allPassed = Boolean(results?.allPassed);
  } catch (err) {
    console.error('Browser benchmark timed out or failed:', err);
  } finally {
    console.log('Closing browser and terminating Vite dev server...');
    await browser.close().catch(() => {});
    await server.close().catch(() => {});
  }

  if (!allPassed) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal runner error:', err);
  process.exit(1);
});
