// Native configuration is authoritative. The URL hash is only a fail-closed hint
// for a renderer whose preload bridge is missing; it never grants access.
const { pathToFileURL, fileURLToPath } = require('node:url');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const HASH = '#encrypted-workspace';
function createEncryptionLaunchPolicy({ mode, indexPath }) {
  if (!['legacy', 'encrypted', 'enrollment-pending'].includes(mode) || !path.isAbsolute(indexPath)) throw new Error('Invalid native workspace launch configuration.');
  const protectedMode = mode !== 'legacy', indexUrl = pathToFileURL(indexPath).href;
  const partition = protectedMode ? 'encrypted-workspace-' + randomUUID() : null;
  function permits(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'file:' && !parsed.hostname && !parsed.username && !parsed.password && !parsed.search && fileURLToPath(parsed) === indexPath && (!protectedMode || parsed.hash === HASH);
    } catch { return false; }
  }
  function observesEphemeral(window) {
    if (!protectedMode) return false;
    try { return window.webContents.session.isPersistent() === false && window.webContents.session.storagePath === null; } catch { return false; }
  }
  return Object.freeze({ mode, protectedMode, partition, indexPath, indexUrl, hash: protectedMode ? HASH.slice(1) : undefined, permits, observesEphemeral });
}
function attachEncryptionWindowGuards({ window, policy, lock, onViolation }) {
  let violated = false;
  const deny = reason => {
    if (violated) return; violated = true; lock();
    try { window.hide(); window.webContents.stop(); } catch {}
    onViolation(reason);
  };
  if (policy.protectedMode && !policy.observesEphemeral(window)) { deny('partition'); return false; }
  window.on('closed', lock);
  window.webContents.on('render-process-gone', () => { lock(); if (policy.protectedMode) deny('renderer'); });
  window.webContents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => { if (isMainFrame) lock(); });
  if (policy.protectedMode) {
    window.webContents.on('preload-error', () => deny('preload'));
    window.webContents.on('will-navigate', (event, url) => { if (!policy.permits(url)) { event.preventDefault(); deny('navigation'); } });
    // will-navigate does not cover same-document fragment changes.
    window.webContents.on('did-navigate-in-page', (_event, url, isMainFrame) => { if (isMainFrame && !policy.permits(url)) deny('fragment'); });
  }
  return true;
}
module.exports = { createEncryptionLaunchPolicy, attachEncryptionWindowGuards, PROTECTED_LAUNCH_HASH: HASH };
