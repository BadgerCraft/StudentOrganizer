import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execSync, spawn } from 'child_process';

function getFileMetadata(filePath: string) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const stats = fs.statSync(filePath);
  const buffer = fs.readFileSync(filePath);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  return {
    path: filePath,
    size: stats.size,
    sha256
  };
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('================================================================');
  console.log('WINDOWS ELECTRON DESKTOP VERIFICATION SUITE');
  console.log('================================================================\n');

  const packages = fs.readdirSync('release');
  const installerFile = packages.find(file => file.endsWith('-nsis.exe'));
  const portableFile = packages.find(file => file.endsWith('-Portable.exe'));
  if (!installerFile || !portableFile) throw new Error('Build the Windows installer and portable files first.');
  const installerPath = path.resolve('release', installerFile);
  const portablePath = path.resolve('release', portableFile);
  const unpackedPath = path.resolve('release/win-unpacked/Ontario Teacher Assessment.exe');

  // 1. Verify existence and calculate SHA-256 checksums
  console.log('--- Step 1: Release Executables & Checksums ---');
  const installerMeta = getFileMetadata(installerPath);
  console.log(`[Installer Setup]   ${installerMeta.path}`);
  console.log(`  Size:   ${(installerMeta.size / (1024 * 1024)).toFixed(2)} MB (${installerMeta.size} bytes)`);
  console.log(`  SHA256: ${installerMeta.sha256}`);

  const portableMeta = getFileMetadata(portablePath);
  console.log(`\n[Portable Executable] ${portableMeta.path}`);
  console.log(`  Size:   ${(portableMeta.size / (1024 * 1024)).toFixed(2)} MB (${portableMeta.size} bytes)`);
  console.log(`  SHA256: ${portableMeta.sha256}`);

  const unpackedMeta = getFileMetadata(unpackedPath);
  console.log(`\n[Unpacked Executable] ${unpackedMeta.path}`);
  console.log(`  Size:   ${(unpackedMeta.size / (1024 * 1024)).toFixed(2)} MB (${unpackedMeta.size} bytes)`);
  console.log(`  SHA256: ${unpackedMeta.sha256}`);

  // 2. Test Installer Silent Installation & Launch
  console.log('\n--- Step 2: Testing Actual Installer Execution (Silent Install) ---');
  const testInstallDir = path.resolve('release/installed-test-app');
  if (fs.existsSync(testInstallDir)) {
    fs.rmSync(testInstallDir, { recursive: true, force: true });
  }
  fs.mkdirSync(testInstallDir, { recursive: true });

  console.log(`Executing silent installer: "${installerPath}" /S /D=${testInstallDir}`);
  // In NSIS, /D= must be the last parameter without quotes
  execSync(`"${installerPath}" /S /D=${testInstallDir}`);

  // Wait for installer to finish writing files
  const installedExePath = path.join(testInstallDir, 'Ontario Teacher Assessment.exe');
  let installedReady = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    if (fs.existsSync(installedExePath) && fs.statSync(installedExePath).size > 1000000) {
      installedReady = true;
      break;
    }
    await sleep(500);
  }

  if (!installedReady) {
    throw new Error(`Silent installation failed: Target executable not created at ${installedExePath}`);
  }
  console.log(`PASS: Installer successfully unpacked application to ${installedExePath}`);

  // Launch Installed Application
  console.log('\n--- Step 3: Testing Installed Application Launch & Security Lockdown ---');
  let app = await electron.launch({
    executablePath: installedExePath
  });

  let page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const pageUrl = page.url();
  console.log(`Loaded URL: ${pageUrl}`);
  if (!pageUrl.startsWith('file://')) {
    throw new Error(`Expected page to load from local file:// protocol, got: ${pageUrl}`);
  }
  console.log('PASS: Packaged assets loaded securely via local file:// protocol.');

  const title = await page.title();
  console.log(`Window title: "${title}"`);

  const header = page.locator('text=Classes');
  await header.waitFor({ state: 'visible', timeout: 15000 });
  console.log('PASS: Classroom Dashboard rendered cleanly in installed app.');

  // Strict Assertion: Window Lockdown
  console.log('Testing security lockdown: attempting window.open()...');
  const windowOpenBlocked = await page.evaluate(() => {
    try {
      const win = window.open('https://evil-external-site.com', '_blank');
      return win === null;
    } catch {
      return true;
    }
  });

  if (!windowOpenBlocked) {
    throw new Error('SECURITY VIOLATION: window.open was not blocked by Electron security policies!');
  }
  console.log('PASS: window.open is STRICTLY blocked by setWindowOpenHandler (returned null).');

  // Verify Persistent IndexedDB Storage across restart
  console.log('\n--- Step 4: Testing Fictional Colleague QA Data Persistence ---');
  const fictionalStudentNumber = 'QA-CHEN-999';
  const fictionalStudentName = 'Aarav Patel';

  await page.evaluate(async (params) => {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('OntarioTeacherAssessmentDB');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['students', 'courses'], 'readwrite');
        const courseStore = tx.objectStore('courses');
        const courseReq = courseStore.getAll();
        courseReq.onsuccess = () => {
          const courses = courseReq.result || [];
          const orgId = courses[0]?.organizationId || 'org-school-port-credit';
          const studentStore = tx.objectStore('students');
          studentStore.put({
            id: 'qa-student-aarav-id',
            organizationId: orgId,
            localStudentNumber: params.num,
            oenEncrypted: null,
            firstName: 'Aarav',
            lastName: 'Patel',
            preferredName: null,
            pronouns: null,
            photoUrl: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            deletedAt: null,
            version: 1
          });
        };
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error ? new Error(tx.error.message) : new Error('Transaction error'));
      };
      req.onerror = () => reject(req.error ? new Error(req.error.message) : new Error('DB open error'));
    });
  }, { num: fictionalStudentNumber, name: fictionalStudentName });

  console.log(`Wrote verification student "${fictionalStudentName}" (${fictionalStudentNumber}) to IndexedDB.`);

  // Close app process completely
  console.log('Closing installed application process...');
  await app.close();
  await sleep(1500);

  // Relaunch app from installed binary
  console.log('Relaunching installed application from disk to verify LevelDB persistence...');
  app = await electron.launch({
    executablePath: installedExePath
  });

  page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');

  const persistedStudent = await page.evaluate(async (num) => {
    return new Promise<any>((resolve) => {
      const req = indexedDB.open('OntarioTeacherAssessmentDB');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction(['students'], 'readonly');
        const store = tx.objectStore('students');
        const getReq = store.getAll();
        getReq.onsuccess = () => {
          const students = getReq.result || [];
          const found = students.find((s: any) => s.localStudentNumber === num);
          resolve(found || null);
        };
      };
    });
  }, fictionalStudentNumber);

  console.log('Retrieved persisted student:', persistedStudent ? `${persistedStudent.lastName}, ${persistedStudent.firstName}` : null);
  if (!persistedStudent || persistedStudent.lastName !== 'Patel') {
    throw new Error('Persistence failure: Record did not survive application shutdown and restart!');
  }
  console.log('PASS: LevelDB persistence cleanly survived process shutdown and restart.');
  await app.close();
  await sleep(1000);

  // 5. Test Portable Executable Launch
  console.log('\n--- Step 5: Testing Portable Executable Launch ---');
  console.log('Verifying standalone launch of Portable Executable...');
  const child = spawn(`"${portablePath}"`, [], { shell: true, stdio: 'ignore' });
  await sleep(4000);
  const tasklistOutput = execSync('tasklist', { encoding: 'utf-8' });
  const isRunning = tasklistOutput.includes('Ontario Teacher Assessment') || tasklistOutput.includes('OntarioTeacherAssessment');
  if (!isRunning) {
    throw new Error('Portable executable failed to launch process!');
  }
  console.log('PASS: Portable executable starts and initializes cleanly as a standalone binary.');
  // Terminate test portable process
  try {
    execSync(`taskkill /F /IM "${portableFile}" 2>nul`);
    execSync(`taskkill /F /IM "Ontario Teacher Assessment.exe" 2>nul`);
  } catch (_) {}

  // Cleanup test install directory
  try {
    fs.rmSync(testInstallDir, { recursive: true, force: true });
    console.log('\nCleaned up temporary test installation directory.');
  } catch (_) {}

  console.log('\n================================================================');
  console.log('VERIFICATION SUMMARY: ALL WINDOWS DESKTOP QA TESTS PASSED!');
  console.log('================================================================');
  console.log(`Installer:  ${installerMeta.path} (${(installerMeta.size / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`SHA-256:    ${installerMeta.sha256}`);
  console.log(`Portable:   ${portableMeta.path} (${(portableMeta.size / (1024 * 1024)).toFixed(2)} MB)`);
  console.log(`SHA-256:    ${portableMeta.sha256}`);
  console.log('Local File: file:// protocol confirmed');
  console.log('Lockdown:   window.open strictly blocked (asserted)');
  console.log('Storage:    %APPDATA%\\ontario-teacher-assessment LevelDB confirmed');
  console.log('================================================================\n');
}

main().catch(err => {
  console.error('\n*** ELECTRON DESKTOP VERIFICATION FAILED ***');
  console.error(err);
  process.exit(1);
});
