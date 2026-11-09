// Raw JavaScript is intentional: tsx adds __name helpers inside serialized callbacks.
// These isolated browser fixtures must not depend on helpers in the Node process.
export const STARTUP_UPDATE_FIXTURE = String.raw`(() => {
  const state = { offer: { status: 'available', version: '1.0.2', installationAvailable: true }, downloads: 0, installs: 0, checks: 0, startupReads: 0,
    installOutcome: 'installing', backup: '', acknowledge: null, downloaded: null, finish: null };
  window.__updates = state;
  window.desktopUpdates = {
    platform: 'win32', mode: 'github-release',
    startupStatus: async () => { state.startupReads++; return state.offer; },
    check: async () => { state.checks++; return state.offer; },
    status: async () => state.downloaded || { status: 'idle', installationAvailable: true },
    download: async () => { state.downloads++; state.downloaded = { status: 'downloading', installationAvailable: true, percent: 42 }; return await new Promise(resolve => { state.finish = outcome => { state.downloaded = outcome; resolve(outcome); }; }); },
    cancel: async () => { const result = { status: 'cancelled', installationAvailable: true }; state.finish?.(result); return result; },
    install: async (backup, acknowledge) => { state.installs++; state.backup = backup; state.acknowledge = acknowledge; return { status: state.installOutcome, installationAvailable: true, error: state.installOutcome === 'error' ? 'Fictional installer launch failure; the app has stayed open.' : undefined }; }
  };
})()`;

export const HOLD_UPDATE_WRITE = String.raw`new Promise((resolve, reject) => {
  const opening = indexedDB.open('OntarioTeacherAssessmentDB'); opening.onerror = () => reject(opening.error);
  opening.onsuccess = () => {
    const database = opening.result;
    const transaction = database.transaction(Array.from(database.objectStoreNames), 'readwrite');
    let holding = true; window.__releaseUpdateWrite = () => { holding = false; };
    const store = transaction.objectStore('users');
    const keepAlive = () => { const request = store.get('__fictional_update_hold__'); request.onsuccess = () => { if (holding) keepAlive(); }; };
    keepAlive(); transaction.oncomplete = () => database.close(); resolve();
  };
})`;

export interface UpdateVisualElement {
  left: number; right: number; top: number; bottom: number; width: number; height: number;
  color: string; background: string; unobscured: boolean;
}
export interface UpdateBannerVisuals {
  theme: string; viewport: number; sidebarRight: number;
  banner: UpdateVisualElement; text: UpdateVisualElement[]; buttons: UpdateVisualElement[];
}

// Computed pixels, geometry and hit testing are measured in the actual production renderer.
export const READ_UPDATE_BANNER_VISUALS = String.raw`(() => {
  const banner = document.querySelector('[data-testid="startup-update-banner"]');
  const sidebar = document.querySelector('[aria-label="Main navigation"]');
  const measure = element => {
    const box = element.getBoundingClientRect(), style = getComputedStyle(element);
    const hit = document.elementFromPoint(box.left + Math.min(4, box.width / 2), box.top + box.height / 2);
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height,
      color: style.color, background: style.backgroundColor,
      unobscured: !!hit && (hit === element || element.contains(hit)) && !sidebar.contains(hit) };
  };
  return { theme: document.documentElement.dataset.theme, viewport: innerWidth,
    sidebarRight: sidebar.getBoundingClientRect().right, banner: measure(banner),
    text: Array.from(banner.querySelectorAll('p')).map(measure),
    buttons: Array.from(banner.querySelectorAll('button:not(:disabled)')).map(measure) };
})()`;
