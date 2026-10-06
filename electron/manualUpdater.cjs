// Manual metadata lookup only. No installer download/execution or renderer-selected URLs.
const https = require('node:https');
const ENDPOINT = 'https://api.github.com/repos/BadgerCraft/StudentOrganizer/releases/latest';
const LIMIT = 128 * 1024;
function version(value) {
  const match = /^(?:v)?(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.exec(value);
  if (!match) throw new Error('Unsupported version');
  return match.slice(1).map(Number);
}
function isNewer(next, current) {
  const a = version(next), b = version(current);
  for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
  return false;
}
function releaseUrl(value, tag) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.port || url.username || url.password || url.search || url.hash ||
      url.pathname !== `/BadgerCraft/StudentOrganizer/releases/tag/${tag}`) throw new Error('Invalid release destination');
  return url.href;
}
function parseRelease(data, current) {
  if (!data || typeof data !== 'object' || data.draft !== false || data.prerelease !== false || typeof data.tag_name !== 'string') throw new Error('Invalid release');
  version(data.tag_name);
  const url = releaseUrl(data.html_url, data.tag_name);
  return { status: isNewer(data.tag_name, current) ? 'available' : 'current', version: data.tag_name.replace(/^v/, ''), url,
    installationAvailable: false };
}
function trustedCaller(event, contents, expectedUrl) {
  return event.sender === contents && event.senderFrame === contents.mainFrame &&
    event.senderFrame?.url.split('#')[0] === expectedUrl;
}
function requestLatest() {
  return new Promise((resolve, reject) => {
    const request = https.get(ENDPOINT, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'StudentOrganizer-manual-update-check' }, timeout: 10000 }, response => {
      // Redirects are never followed. This request contains no local records or device IDs.
      if (response.statusCode === 404) { response.resume(); resolve(null); return; }
      if (response.statusCode !== 200) { response.resume(); reject(new Error('Release unavailable')); return; }
      let bytes = 0, body = '';
      response.on('data', chunk => { bytes += chunk.length; if (bytes > LIMIT) { response.destroy(new Error('Response too large')); return; } body += chunk.toString('utf8'); });
      response.on('error', reject);
      response.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid response')); } });
    });
    request.on('timeout', () => request.destroy(new Error('Timeout')));
    request.on('error', reject);
  });
}
function createManualCheck({ platform, packaged, currentVersion, lookup = requestLatest }) {
  let pending;
  return () => {
    if (platform !== 'win32' || !packaged) return Promise.resolve({ status: 'unsupported' });
    if (pending) return pending;
    pending = (async () => {
      try { const data = await lookup(); return data === null ? { status: 'unpublished' } : parseRelease(data, currentVersion); }
      catch { return { status: 'error' }; }
      finally { pending = undefined; }
    })();
    return pending;
  };
}
module.exports = { ENDPOINT, version, isNewer, releaseUrl, parseRelease, trustedCaller, createManualCheck };
