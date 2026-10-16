import Dexie from 'dexie';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import type { Page } from 'playwright';
import { OntarioTeacherDB } from '../../src/db/database';
import { seedDatabase } from '../../src/db/seeds';

let fixture: Promise<Record<string, unknown[]>> | undefined;
async function fictionalRows() {
  if (!fixture) fixture = (async () => {
    const dependencies = { ...Dexie.dependencies };
    Dexie.dependencies.indexedDB = new IDBFactory();
    Dexie.dependencies.IDBKeyRange = IDBKeyRange;
    const database = new OntarioTeacherDB(`fictional-classroom-${crypto.randomUUID()}`);
    try {
      await seedDatabase(database);
      return Object.fromEntries(await Promise.all(database.tables.map(async table => [table.name, await table.toArray()])));
    } finally { await database.delete(); Object.assign(Dexie.dependencies, dependencies); }
  })();
  return fixture;
}

/** Explicit test-only fixture injection for dev, production preview, and Electron.
 * Requires a fresh browser database. Never clears or replaces saved user data.
 * Production startup remains empty; no Vite source-module imports are needed.
 */
export async function installFictionalClassroom(page: Page) {
  await page.getByPlaceholder('Enter Teacher here').waitFor();
  const rows = await fictionalRows();
  await page.evaluate(rows => new Promise<void>((resolve, reject) => {
    const opening = indexedDB.open('OntarioTeacherAssessmentDB');
    opening.onerror = () => reject(opening.error);
    opening.onsuccess = () => {
      const database = opening.result;
      const tables = Object.keys(rows).filter(name => rows[name].length);
      const transaction = database.transaction(tables, 'readwrite');
      let failure: Error | null = null;
      const users = transaction.objectStore('users').count();
      users.onsuccess = () => {
        const classes = transaction.objectStore('classSections').count();
        classes.onsuccess = () => {
          if (users.result || classes.result) {
            failure = new Error('Fictional fixture requires a fresh browser database; existing profiles/classes were preserved.'); transaction.abort(); return;
          }
          for (const name of tables) for (const row of rows[name]) transaction.objectStore(name).add(row);
        };
      };
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onabort = () => { database.close(); reject(failure ?? transaction.error ?? new Error('Fictional fixture installation failed.')); };
      transaction.onerror = () => { /* onabort reports the error after rollback. */ };
    };
  }), rows);
  await page.reload();
  await page.locator('[data-testid^="select-teacher-"]').first().waitFor();
}
