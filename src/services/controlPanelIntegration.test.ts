import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const { attachControlPanel } = require('../../electron/controlPanel.cjs');
const approval = require('../../electron/updateApproval.cjs');

describe('integrated Control Panel native actions', () => {
  async function fixture(run: (value: any) => Promise<void>) {
    const root = await mkdtemp(path.join(tmpdir(), 'owner-role-'));
    const indexPath = path.join(root, 'roles.html'); await writeFile(indexPath, 'fictional');
    const index = pathToFileURL(indexPath).href;
    const frame: any = { url: index, parent: null };
    const contents: any = { mainFrame: frame, isDestroyed: () => false, getURL: () => index };
    const event = { sender: contents, senderFrame: frame };
    const handlers: any = {};
    const storeFile = path.join(root, 'integrated', 'local-approval.json');
    const legacyStoreFile = path.join(root, 'legacy.json');
    const candidate = approval.prepare({ schemaVersion: 1, product: 'StudentOrganizer', version: '1.0.2', arch: 'x64', sourceCommit: 'a'.repeat(40), artifact: { name: 'OntarioTeacherAssessment-1.0.2-x64-nsis.exe', bytes: 1, sha512: createHash('sha512').update('x').digest('base64') } });
    await writeFile(path.join(root, 'OntarioTeacherAssessment-1.0.2-x64-nsis.exe'), 'x');
    const legacy = JSON.stringify({ approval: candidate, artifactPath: path.join(root, 'OntarioTeacherAssessment-1.0.2-x64-nsis.exe') });
    await writeFile(legacyStoreFile, legacy);
    const dialog = { showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => ({ canceled: false, filePath: legacyStoreFile }) };
    const attach = () => attachControlPanel({ ipcMain: { handle: (name: string, handler: any) => { handlers[name] = handler; } }, dialog, getWindow: () => ({ webContents: contents }), index, storeFile, legacyStoreFile });
    try { await attach(); await run({ handlers, event, root, legacyStoreFile, legacy, storeFile, attach }); }
    finally { await rm(root, { recursive: true, force: true }); }
  }
  it('reads legacy preparation without mutating it and keeps cancelled import intact', async () => fixture(async ({ handlers, event, legacyStoreFile, legacy }) => {
    expect((await handlers['owner:status'](event)).approval.status).toBe('candidate');
    expect((await handlers['owner:import'](event)).message).toBe('Import cancelled.');
    expect(await readFile(legacyStoreFile, 'utf8')).toBe(legacy);
  }));
  it('never overwrites the preserved legacy record with an exported preview', async () => fixture(async ({ handlers, event, legacyStoreFile, legacy }) => {
    await handlers['owner:test'](event, 'Fictional completed verification');
    await handlers['owner:approve'](event);
    expect((await handlers['owner:export'](event)).error).toContain('separate .json');
    expect(await readFile(legacyStoreFile, 'utf8')).toBe(legacy);
  }));
  it('rejects foreign frames and extra arguments before any action', async () => fixture(async ({ handlers, event }) => {
    await expect(handlers['owner:status']({ ...event, senderFrame: { url: 'https://example.invalid', parent: null } })).rejects.toThrow('denied');
    await expect(handlers['owner:status'](event, 'extra')).rejects.toThrow('denied');
  }));
  it('does not silently fall back from a corrupt integrated record', async () => fixture(async ({ handlers, event, storeFile, attach }) => {
    await mkdir(path.dirname(storeFile), { recursive: true });
    await writeFile(storeFile, '{broken'); await attach();
    const snapshot = await handlers['owner:status'](event);
    expect(snapshot.approval).toBeNull(); expect(snapshot.message).toContain('Original file retained');
    expect(await readFile(storeFile, 'utf8')).toBe('{broken');
  }));
});
