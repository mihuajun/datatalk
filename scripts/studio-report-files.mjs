#!/usr/bin/env node
/** Native file transport helper, NOT a Skill. Node >=22. No database credentials. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function validPath(name) {
  if (typeof name !== 'string' || name.length > 200 || name.includes('\\') || name.split('/').some(p => !p || p === '.' || p === '..') || !/^(report\.json|description\.md|page\.html|styles\.css|app\.js|server\.js|theme\.json|interactions\.json|(assets|components)\/[A-Za-z0-9][A-Za-z0-9_.-]*\.(html|css|js|json|svg|txt)|data\/(?:[A-Za-z0-9][A-Za-z0-9_.-]*\/)*[A-Za-z0-9][A-Za-z0-9_.-]*\.(json|csv|tsv|txt))$/.test(name)) throw Error('Unsupported source path');
}
async function safePath(root, name, create = false) {
  validPath(name);
  if ((await fs.lstat(root)).isSymbolicLink()) throw Error('Workspace root must not be a symlink');
  let current = root;
  for (const part of name.split('/').slice(0, -1)) {
    current = path.join(current, part);
    if (create) await fs.mkdir(current, { recursive: true });
    const stat = await fs.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Symlink or non-directory in source path');
  }
  const file = path.join(root, name);
  try { const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink()) throw Error('Source is not a regular file'); }
  catch (e) { if (!(create && e.code === 'ENOENT')) throw e; }
  return file;
}
async function bytesFor(root, name) {
  const file = await safePath(root, name);
  if ((await fs.stat(file)).size > 524288) throw Error('File exceeds 512KB');
  const bytes = await fs.readFile(file);
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  if (text.includes('\0')) throw Error('Binary files are not supported in phase one');
  return bytes;
}
export async function fileMain(argv = process.argv.slice(2)) {
  const [command, first, second, ...rest] = argv;
  if (command === 'manifest') {
    if (!first || !second) throw Error('manifest <workspace> <changed-file> [changed-file...]');
    const files = [];
    for (const name of [second, ...rest]) {
      const bytes = await bytesFor(path.resolve(first), name); files.push({ path: name, size: bytes.length, sha256: sha(bytes) });
    }
    if (files.length > 30 || new Set(files.map(f => f.path)).size !== files.length) throw Error('At most 30 unique changed files');
    console.log(JSON.stringify({ files }, null, 2)); return;
  }
  if (!['pull','push'].includes(command) || !first || !second) throw Error('Usage: manifest <dir> <files...> | pull <session.credentials.json> <dir> | push <session.credentials.json> <dir>');
  const configStat = await fs.lstat(first);
  if (!configStat.isFile() || configStat.isSymbolicLink() || (process.platform !== 'win32' && (configStat.mode & 0o077))) throw Error('Session credentials must be a regular file readable only by its owner (chmod 600)');
  const session = JSON.parse(await fs.readFile(first, 'utf8'));
  const endpoint = new URL(session.transfer.endpoint);
  if (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(endpoint.hostname))) throw Error('HTTPS is required outside loopback');
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash || !/^\/api\/open\/report-development\/[1-9][0-9]*\/[A-Za-z0-9_-]+\/[a-f0-9]{32}$/.test(endpoint.pathname) || !/^Bearer [A-Za-z0-9_-]{43}$/.test(session.transfer.authorization)) throw Error('Invalid transfer configuration');
  if (Date.parse(session.expiresAt) <= Date.now()) throw Error('Development session expired');
  const root = path.resolve(second); await fs.mkdir(root, { recursive: true });
  const entries = command === 'pull' ? session.files : session.uploadManifest;
  for (const entry of entries) {
    validPath(entry.path);
    const url = new URL(endpoint); url.searchParams.set('path', entry.path);
    const bytes = command === 'push' ? await bytesFor(root, entry.path) : undefined;
    if (bytes && (bytes.length !== entry.size || sha(bytes) !== entry.sha256)) throw Error('Local file changed after manifest; create a new session');
    const response = await fetch(url, { method: command === 'push' ? 'PUT' : 'GET', redirect: 'error', signal: AbortSignal.timeout(60000), headers: { Authorization: session.transfer.authorization, 'Content-Type': 'application/octet-stream' }, body: bytes });
    if (!response.ok) throw Error(`Transfer failed with HTTP ${response.status}`);
    if (command === 'pull') {
      if (!Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 524288) throw Error('Invalid manifest size');
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > entry.size) throw Error('Download exceeds manifest size'); chunks.push(chunk); }
      const downloaded = Buffer.concat(chunks);
      if (downloaded.length !== entry.size || sha(downloaded) !== entry.sha256) throw Error('Downloaded file integrity mismatch');
      const target = await safePath(root, entry.path, true);
      try { await fs.writeFile(target, downloaded, { flag: 'wx' }); }
      catch(e) { if (e.code !== 'EEXIST' || sha(await fs.readFile(target)) !== entry.sha256) throw Error('Refusing to overwrite existing local edits'); }
    }
    console.log(`${command}: ${entry.path} (${entry.size} bytes)`);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) fileMain().catch(e => { console.error(e.message); process.exitCode = 1; });
