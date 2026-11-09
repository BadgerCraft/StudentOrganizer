const { parseRelease } = require('./manualUpdater.cjs');

// One metadata-only startup check per process. Status reads never contact GitHub;
// failures leave the local app usable and only an explicit retry starts another check.
function createStartupUpdateCheck({ platform, packaged, currentVersion, arch = process.arch,
  mode = 'github-release', lookup = (targetArch, targetPlatform) => require('./githubReleaseDelivery.cjs').lookupLatest(targetArch, targetPlatform),
  capability = async () => ({ installationAvailable: false }) }) {
  const supported = packaged && ['win32', 'darwin'].includes(platform);
  let state = { status: supported ? 'idle' : 'unsupported', installationAvailable: false };
  let pending, started = false;
  const status = () => ({ ...state });
  function check() {
    if (!supported) return Promise.resolve(status());
    if (pending) return pending;
    state = { status: 'checking', installationAvailable: false };
    pending = (async () => {
      try {
        const published = await lookup(arch, platform);
        if (!published) state = { status: 'unpublished', installationAvailable: false };
        else {
          state = parseRelease(published.release, currentVersion);
          if (state.status === 'available') {
            const available = platform === 'darwin'
              ? { installationAvailable: false, message: 'One-click Mac installation is not available in this build. It requires a signed Mac release and a verified Mac replacement and recovery path. Your current app remains usable.' }
              : await capability();
            state = { ...state, installationAvailable: available.installationAvailable === true,
              ...(available.message ? { message: available.message } : {}) };
          }
        }
      } catch {
        state = { status: 'error', installationAvailable: false,
          message: 'Updates could not be checked. Retry in Settings when your connection is ready. Your installed app and records have not changed.' };
      } finally { pending = undefined; }
      return status();
    })();
    return pending;
  }
  function start() {
    if (started || mode !== 'github-release') return pending || Promise.resolve(status());
    started = true;
    return check();
  }
  return { start, check, status };
}
module.exports = { createStartupUpdateCheck };
