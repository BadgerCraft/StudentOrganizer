const { createHash } = require('node:crypto');
const API = 'https://www.googleapis.com/drive/v3/';
const MAX_BYTES = 256 * 1024 * 1024; // shared/capturePackage CAPTURE_LIMITS.archiveBytes
const FIELDS = 'id,name,mimeType,size,sha256Checksum,trashed,shared,ownedByMe,owners(permissionId),parents,version';
class DriveError extends Error { constructor(message) { super(message); this.name = 'DriveError'; } }
const fail = message => { throw new DriveError(message); };
const idOK = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(id);
const captureName = name => typeof name === 'string' && /^capture-[A-Za-z0-9][A-Za-z0-9_-]{0,79}-r[1-9][0-9]*\.zip$/.test(name);
async function boundedBody(response, limit, signal) {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > limit)) fail('Drive response exceeds the allowed size.');
  if (!response.body) fail('Drive returned an empty response.');
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    for (;;) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) fail('Drive response exceeds the allowed size.');
      chunks.push(value);
    }
    signal.throwIfAborted();
    if (declared !== null && length !== Number(declared)) fail('Download interrupted. Retry the assignment.');
    return Buffer.concat(chunks, length);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
/** Only an explicit foreground operation can use a main-process, memory-only token. */
function createCaptureDrive({ authorize, configured, fetchImpl = fetch, now = Date.now }) {
  let access = null, active = null, listed = new Map();
  const status = () => ({ configured: configured(), connected: !!access && access.expiresAt > now() });
  function cancel() { active?.abort(); return { cancelled: true }; }
  function disconnect() { cancel(); access = null; listed.clear(); return status(); }
  async function operation(fn) {
    if (active) fail('Another Drive action is running. Cancel it or wait.');
    const controller = new AbortController(); active = controller;
    const timer = setTimeout(() => controller.abort(), 5 * 60_000);
    try { const value = await fn(controller.signal); controller.signal.throwIfAborted(); return value; }
    catch (error) {
      if (controller.signal.aborted) fail('Drive action cancelled or timed out. Retry when ready; saved matches are retained.');
      if (error instanceof DriveError) throw error;
      fail('Drive could not complete the request. Check your connection and retry; saved matches are retained.');
    } finally { clearTimeout(timer); if (active === controller) active = null; }
  }
  async function request(path, signal, limit = 1024 * 1024) {
    if (!access || access.expiresAt <= now()) { access = null; listed.clear(); fail('Drive access expired. Connect again.'); }
    // Paths are constructed here only; no renderer URL or remote redirect is followed.
    const response = await fetchImpl(API + path, { headers: { Authorization: `Bearer ${access.token}` }, redirect: 'error', signal });
    if (response.status === 401) { access = null; listed.clear(); fail('Drive access expired or was revoked. Connect again.'); }
    if (!response.ok) { await response.body?.cancel(); fail(response.status === 403 || response.status === 404 ? 'Drive denied access to this upload. Check the connected account and app setup, then refresh.' : 'Drive is temporarily unavailable. Retry when ready.'); }
    return boundedBody(response, limit, signal);
  }
  async function json(path, signal) { return JSON.parse((await request(path, signal)).toString('utf8')); }
  async function identity(signal) {
    const value = await json('about?fields=user(permissionId)', signal);
    if (!idOK(value.user?.permissionId)) fail('Could not verify the Drive account.');
    return value.user.permissionId;
  }
  async function privateMetadata(id, owner, signal, folder = false) {
    if (!idOK(id)) fail('Invalid upload identity.');
    const m = await json(`files/${id}?fields=${encodeURIComponent(FIELDS)}`, signal);
    const p = await json(`files/${id}/permissions?pageSize=100&fields=nextPageToken,permissions(id,type,role,deleted)`, signal);
    if (m.id !== id || m.trashed !== false || m.shared !== false || m.ownedByMe !== true || m.owners?.length !== 1 || m.owners[0].permissionId !== owner || m.parents?.length !== 1 || !idOK(m.parents[0]) || p.nextPageToken || p.permissions?.length !== 1 || p.permissions[0].id !== owner || p.permissions[0].type !== 'user' || p.permissions[0].role !== 'owner' || p.permissions[0].deleted === true)
      fail('Upload or folder is shared, moved, or cannot be verified as private. No import was made.');
    if (folder ? m.mimeType !== 'application/vnd.google-apps.folder' : m.mimeType !== 'application/zip' || !captureName(m.name) || !/^\d+$/.test(m.size) || Number(m.size) < 1 || Number(m.size) > MAX_BYTES || !/^[a-fA-F0-9]{64}$/.test(m.sha256Checksum) || typeof m.version !== 'string') fail('This is not a supported completed capture upload.');
    return m;
  }
  async function pages(query, fields, signal) {
    const result = [], seen = new Set(); let page;
    for (let i = 0; i < 100; i++) {
      const data = await json(`files?corpora=user&spaces=drive&pageSize=100&q=${encodeURIComponent(query)}&fields=${encodeURIComponent(`nextPageToken,incompleteSearch,files(${fields})`)}${page ? '&pageToken=' + encodeURIComponent(page) : ''}`, signal);
      if (!Array.isArray(data.files) || data.incompleteSearch) fail('Drive listing is incomplete. Retry or use a local ZIP.');
      result.push(...data.files);
      if (!data.nextPageToken) return result;
      page = data.nextPageToken;
      if (typeof page !== 'string' || page.length > 2000 || seen.has(page)) fail('Drive returned an invalid listing.');
      seen.add(page);
    }
    fail('Too many uploads to list safely. Use a local ZIP.');
  }
  return {
    status, cancel, disconnect,
    connect: () => operation(async signal => {
      access = null; listed.clear();
      if (!configured()) fail('Desktop Drive setup is not approved/configured. Use a local ZIP.');
      const candidate = await authorize(signal); signal.throwIfAborted();
      if (!candidate || typeof candidate.token !== 'string' || !candidate.token || !Number.isFinite(candidate.expiresAt) || candidate.expiresAt <= now()) fail('Drive sign-in did not provide usable access.');
      access = candidate;
      try { await identity(signal); } catch (error) { access = null; throw error; }
      return status();
    }),
    list: () => operation(async signal => {
      listed.clear(); await identity(signal);
      const folders = await pages("'root' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'", 'id,name,shared,ownedByMe', signal);
      const folderNames = new Map(folders.filter(m => idOK(m.id) && m.shared === false && m.ownedByMe === true && typeof m.name === 'string' && m.name.length <= 200).map(m => [m.id, m.name]));
      const files = await pages("trashed = false and 'me' in owners and mimeType = 'application/zip'", 'id,name,size,modifiedTime,shared,ownedByMe,parents', signal);
      const uploads = files.filter(m => m.parents?.length === 1 && folderNames.has(m.parents[0]) && idOK(m.id) && captureName(m.name) && m.shared === false && m.ownedByMe === true && /^\d+$/.test(m.size) && Number(m.size) > 0 && Number(m.size) <= MAX_BYTES).map(m => ({ id: m.id, name: m.name, assignmentName: folderNames.get(m.parents[0]), size: Number(m.size), modifiedTime: typeof m.modifiedTime === 'string' ? m.modifiedTime.slice(0,30) : '' }));
      signal.throwIfAborted(); listed = new Map(uploads.map(m => [m.id, m]));
      return uploads;
    }),
    download: id => operation(async signal => {
      if (!idOK(id) || !listed.has(id)) fail('Refresh uploads and choose an available assignment.');
      const owner = await identity(signal);
      const before = await privateMetadata(id, owner, signal);
      const folderId = before.parents[0];
      await privateMetadata(folderId, owner, signal, true);
      const roots = await pages(`'root' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`, 'id', signal);
      if (!roots.some(m => m.id === folderId)) fail('Assignment folder moved. Use the original private upload.');
      const bytes = await request(`files/${id}?alt=media`, signal, Number(before.size));
      if (bytes.length !== Number(before.size) || createHash('sha256').update(bytes).digest('hex') !== before.sha256Checksum.toLowerCase()) fail('Download is incomplete or changed. Refresh and retry.');
      const after = await privateMetadata(id, owner, signal);
      await privateMetadata(folderId, owner, signal, true);
      const finalRoots = await pages(`'root' in parents and trashed = false and mimeType = 'application/vnd.google-apps.folder'`, 'id', signal);
      if (!finalRoots.some(m => m.id === folderId)) fail('Assignment folder moved during download. Refresh and retry.');
      if (await identity(signal) !== owner || before.version !== after.version || after.parents[0] !== folderId || before.sha256Checksum !== after.sha256Checksum || before.size !== after.size) fail('Upload changed during download. Refresh and retry.');
      return { name: before.name, bytes: new Uint8Array(bytes) };
    })
  };
}
module.exports = { createCaptureDrive, boundedBody, DriveError, MAX_BYTES };
