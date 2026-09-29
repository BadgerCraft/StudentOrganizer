import 'fake-indexeddb/auto';
import Dexie, { type Table } from 'dexie';

interface TestItem {
  id: string;
  f1: string;
  f2: string;
  f3: string;
  f4: string;
  f5: string;
  f6: string;
  f7: string;
  f8: string;
  f9: string;
  f10: string;
  f11: string;
  f12: string;
  f13: string;
  f14: string;
  f15: string;
  f16: string;
  value: number;
}

class TestDB extends Dexie {
  unindexedTable!: Table<TestItem, string>;
  indexedTable!: Table<TestItem, string>;

  constructor() {
    super(`test-perf-db-${Date.now()}`);
    this.version(1).stores({
      unindexedTable: 'id',
      indexedTable: 'id, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, f13, f14, f15, f16'
    });
  }
}

async function runComparison() {
  const db = new TestDB();
  const N = 10000;
  console.log(`Generating ${N} records for comparative benchmark...`);

  const records: TestItem[] = [];
  for (let i = 0; i < N; i++) {
    records.push({
      id: `item-${i}`,
      f1: `f1-${i % 100}`,
      f2: `f2-${i % 100}`,
      f3: `f3-${i % 100}`,
      f4: `f4-${i % 100}`,
      f5: `f5-${i % 100}`,
      f6: `f6-${i % 100}`,
      f7: `f7-${i % 100}`,
      f8: `f8-${i % 100}`,
      f9: `f9-${i % 100}`,
      f10: `f10-${i % 100}`,
      f11: `f11-${i % 100}`,
      f12: `f12-${i % 100}`,
      f13: `f13-${i % 100}`,
      f14: `f14-${i % 100}`,
      f15: `f15-${i % 100}`,
      f16: `f16-${i % 100}`,
      value: i
    });
  }

  await db.unindexedTable.bulkAdd(records);
  await db.indexedTable.bulkAdd(records);
  console.log(`Ingestion of ${N} records complete in both tables.`);

  // Prepare 32 existing records with modified values for bulkPut
  const updatesToUnindexed: TestItem[] = [];
  const updatesToIndexed: TestItem[] = [];
  for (let i = 0; i < 32; i++) {
    updatesToUnindexed.push({ ...records[i], value: records[i].value + 1000 });
    updatesToIndexed.push({ ...records[i], value: records[i].value + 1000 });
  }

  // 1. Measure 32-record bulkPut on Unindexed Table
  const t0Unindexed = performance.now();
  await db.unindexedTable.bulkPut(updatesToUnindexed);
  const tUnindexed = performance.now() - t0Unindexed;

  // 2. Measure 32-record bulkPut on 16-Index Table
  const t0Indexed = performance.now();
  await db.indexedTable.bulkPut(updatesToIndexed);
  const tIndexed = performance.now() - t0Indexed;

  console.log('====================================================');
  console.log(`RESULTS FOR 32-RECORD BULK PUT ACROSS ${N} EXISTING ROWS:`);
  console.log(`- Unindexed Table (0 secondary indexes): ${tUnindexed.toFixed(2)} ms`);
  console.log(`- Indexed Table   (16 secondary indexes): ${tIndexed.toFixed(2)} ms`);
  console.log(`- Overhead Factor: ${(tIndexed / Math.max(tUnindexed, 0.01)).toFixed(1)}x slower`);
  console.log('====================================================');

  await db.delete();
}

runComparison().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
