// Isolated browser regression: real LoginForm + WebCrypto + IndexedDB; mocked
// login response/router only. Never connects to a project/production database.
// PLAYWRIGHT_MODULE_PATH=/path/to/playwright/index.mjs node scripts/verify-remembered-login.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const bundle = await build({
  stdin: { contents: `import React from 'react'; import {createRoot} from 'react-dom/client';
    import {LoginForm} from './components/auth/login-form';
    import * as storage from './lib/remembered-login';
    window.testStorage=storage;
    createRoot(document.getElementById('root')).render(<React.StrictMode><LoginForm returnTo="/reports?fixture=1" /></React.StrictMode>);`,
    resolveDir: process.cwd(), loader: 'tsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser',
  plugins: [{ name: 'router-fixture', setup(b) {
    b.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: 'fixture' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, args => ({ contents: args.path.endsWith('navigation')
      ? 'export function useRouter(){return {push:target=>{window.navigationTarget=target},refresh:()=>{}}}'
      : 'import React from "react"; export default function Link(props){return React.createElement("a",props)}', resolveDir: process.cwd() }));
  }}],
});
let failLogin = false;
let submissions = 0;
const server = createServer(async (req, res) => {
  if (req.url === '/bundle.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(bundle.outputFiles[0].text); }
  if (req.url === '/api/login') {
    let body = ''; for await (const chunk of req) body += chunk;
    const data = JSON.parse(body); assert.equal(data.returnTo, '/reports?fixture=1'); submissions++;
    res.setHeader('Content-Type', 'application/json'); res.statusCode = failLogin ? 401 : 200;
    return res.end(JSON.stringify(failLogin ? { message: '测试登录失败' } : { success: true, redirectTo: '/reports?fixture=1' }));
  }
  res.setHeader('Content-Type', 'text/html'); res.end('<html><meta charset="utf-8"><div id="root"></div><script src="/bundle.js"></script></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(path.join(tmpdir(), 'studio-remember-test-'));
const options = { headless: true, executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' };
let context;
let page;
const errors = [];
let checks = 0;
const pass = label => { checks++; console.log(`PASS ${label}`); };
async function launch() {
  context = await chromium.launchPersistentContext(profile, options);
  await context.addInitScript(() => {
    // The original implementation fails in this environment: no password API.
    Object.defineProperty(window, 'PasswordCredential', { value: undefined });
    Object.defineProperty(navigator, 'credentials', { value: undefined });
  });
  page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin); await page.getByLabel('账号', { exact: true }).waitFor();
}
const user = () => page.getByLabel('账号', { exact: true });
const password = () => page.getByLabel('密码', { exact: true });
const checkbox = () => page.getByRole('checkbox');
async function login(remember = true, name = 'fixture@example.invalid', secret = 'fixture-password-only') {
  await user().fill(name); await password().fill(secret); await checkbox().setChecked(remember);
  await page.getByRole('button', { name: '登录', exact: true }).click();
}
async function navigated() { await page.waitForFunction(() => window.navigationTarget === '/reports?fixture=1'); }
async function rawRecord(change) {
  return page.evaluate(async (change) => {
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('datatalk-remembered-login', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('credentials', change ? 'readwrite' : 'readonly');
        const store = tx.objectStore('credentials'); const request = store.get('password-login');
        let record;
        request.onsuccess = () => {
          record = request.result;
          if (change === 'expire') { record.expiresAt = 0; store.put(record, 'password-login'); }
          if (change === 'corrupt') { record.ciphertext = new Uint8Array([1, 2, 3]).buffer; store.put(record, 'password-login'); }
        };
        tx.oncomplete = () => resolve(record ? { extractable: record.key.extractable, algorithm: record.key.algorithm.name, hasPassword: 'password' in record, hasUsername: 'username' in record, encrypted: record.ciphertext instanceof ArrayBuffer } : null);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }, change);
}
try {
  await launch();
  await page.evaluate(() => window.testStorage.readRememberedLogin());
  assert.equal(await user().inputValue(), ''); assert.equal(await checkbox().isChecked(), false); pass('fresh visit is empty and opt-in');
  failLogin = true; await login(); await page.getByRole('alert').waitFor();
  assert.equal(await rawRecord(), null); pass('failed authentication never saves a password');
  failLogin = false; await login(); await navigated();
  assert.deepEqual(await rawRecord(), { extractable: false, algorithm: 'AES-GCM', hasPassword: false, hasUsername: false, encrypted: true });
  assert.equal(await page.evaluate(() => localStorage.length), 0); pass('successful opt-in stores ciphertext and non-exportable key, not plaintext/localStorage');
  await page.reload(); await page.waitForFunction(() => document.querySelector('#login-password')?.value === 'fixture-password-only');
  assert.equal(await user().inputValue(), 'fixture@example.invalid'); assert.equal(await checkbox().isChecked(), true);
  assert.equal(await password().getAttribute('type'), 'password'); pass('reload fills both fields without PasswordCredential; password remains masked');
  await context.close(); await launch();
  await page.waitForFunction(() => document.querySelector('#login-password')?.value === 'fixture-password-only'); pass('full browser restart restores both fields from the same profile');
  await checkbox().uncheck(); await page.evaluate(() => window.testStorage.readRememberedLogin());
  assert.equal(await rawRecord(), null); await page.reload(); await page.evaluate(() => window.testStorage.readRememberedLogin());
  assert.equal(await user().inputValue(), ''); assert.equal(await password().inputValue(), ''); pass('uncheck deletes immediately, without another login');
  await login(false); await navigated(); assert.equal(await rawRecord(), null); pass('successful opt-out does not save');
  await page.reload(); await login(true, 'new@example.invalid', 'replacement-password'); await navigated();
  await page.reload(); await page.waitForFunction(() => document.querySelector('#login-password')?.value === 'replacement-password');
  assert.equal(await user().inputValue(), 'new@example.invalid'); pass('new successful login replaces the remembered account/password');
  for (const change of ['expire', 'corrupt']) {
    await rawRecord(change); await page.reload();
    await page.evaluate(() => window.testStorage.readRememberedLogin());
    assert.equal(await rawRecord(), null); assert.equal(await password().inputValue(), ''); pass(`${change} record is cleared safely`);
    await login(); await navigated();
  }
  // Delay restoration across a real form mount and type before it completes.
  await page.addInitScript(() => {
    if (sessionStorage.getItem('delay-restore') !== '1') return;
    const original = crypto.subtle.decrypt.bind(crypto.subtle);
    crypto.subtle.decrypt = async (...args) => {
      crypto.subtle.decrypt = original;
      await new Promise(resolve => { window.releaseRestore = resolve; });
      return original(...args);
    };
  });
  await page.evaluate(() => sessionStorage.setItem('delay-restore', '1'));
  await page.reload(); await page.waitForFunction(() => typeof window.releaseRestore === 'function');
  await user().fill('typing@example.invalid'); await password().fill('typing-fixture');
  await page.evaluate(() => { sessionStorage.removeItem('delay-restore'); window.releaseRestore(); });
  // Flush the serialized read without triggering a second delayed decrypt.
  await page.evaluate(() => window.testStorage.clearRememberedLogin());
  assert.equal(await user().inputValue(), 'typing@example.invalid'); assert.equal(await password().inputValue(), 'typing-fixture');
  pass('late restore cannot overwrite user input');
  await page.reload();
  await page.evaluate(() => {
    const original = crypto.subtle.decrypt.bind(crypto.subtle);
    crypto.subtle.decrypt = async (...args) => { await new Promise(resolve => setTimeout(resolve, 350)); return original(...args); };
  });
  await page.evaluate(async () => {
    const clearing = window.testStorage.clearRememberedLogin();
    await clearing;
    await window.testStorage.saveRememberedLogin({ username: 'race@example.invalid', password: 'race-fixture' });
    await Promise.all([window.testStorage.readRememberedLogin(), window.testStorage.clearRememberedLogin()]);
  });
  assert.equal(await rawRecord(), null); pass('queued opt-out wins over an in-flight read');
  await page.evaluate(() => localStorage.setItem('datatalk-remember-password', '1')); await page.reload();
  await page.evaluate(() => window.testStorage.readRememberedLogin()); assert.equal(await checkbox().isChecked(), false);
  assert.equal(await page.evaluate(() => localStorage.getItem('datatalk-remember-password')), null); pass('legacy checked-only flag is not mistaken for stored credentials');
  await page.evaluate(() => {
    Object.defineProperty(window, 'localStorage', { configurable: true, get: () => { throw new DOMException('Blocked localStorage', 'SecurityError'); } });
  });
  await login(); await navigated(); assert.ok(await rawRecord()); pass('blocked localStorage does not break login or encrypted storage');
  await page.reload(); await page.waitForFunction(() => document.querySelector('#login-password')?.value === 'fixture-password-only');
  failLogin = true; await login(true, 'wrong@example.invalid', 'wrong-fixture'); await page.getByRole('alert').waitFor();
  failLogin = false; await page.reload(); await page.waitForFunction(() => document.querySelector('#login-password')?.value === 'fixture-password-only');
  assert.equal(await user().inputValue(), 'fixture@example.invalid'); pass('failed login preserves the last successfully saved credential');
  // Storage errors must not turn a successful authentication into a login error.
  await page.evaluate(() => { indexedDB.open = () => { throw new DOMException('Fixture storage blocked', 'SecurityError'); }; });
  await login(); await page.getByRole('button', { name: '继续进入' }).waitFor();
  assert.match(await page.getByRole('status').innerText(), /登录已成功.*未能保存/);
  await page.getByRole('button', { name: '继续进入' }).click(); await navigated(); pass('storage failure explains the limitation and allows authenticated navigation');
  assert.deepEqual(errors, []); assert.ok(submissions >= 7); pass('no uncaught browser errors');
  console.log(JSON.stringify({ ok: true, checks, environment: 'isolated Chromium component harness; mocked login API/router' }));
} finally {
  await context?.close(); await new Promise(resolve => server.close(resolve)); await rm(profile, { recursive: true, force: true });
}
