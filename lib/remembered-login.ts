// Browser-only, opt-in convenience storage, NOT a password vault. The key and
// ciphertext share an origin: XSS or access to this browser can still use them.
// Never put the password (or an exportable encryption key) in localStorage.
const DATABASE = "datatalk-remembered-login";
const STORE = "credentials";
const ENTRY = "password-login";
const MAX_AGE = 30 * 24 * 60 * 60 * 1000;

type Login = { username: string; password: string };
type SavedLogin = { version: 1; key: CryptoKey; iv: Uint8Array<ArrayBuffer>; ciphertext: ArrayBuffer; expiresAt: number };

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let finished = false;
    const timer = setTimeout(() => {
      finished = true;
      reject(new Error("Credential storage timed out"));
    }, 2500);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => { clearTimeout(timer); reject(request.error); };
    request.onsuccess = () => {
      clearTimeout(timer);
      if (finished) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function access<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      const timer = setTimeout(() => {
        transaction.abort();
        reject(new Error("Credential storage timed out"));
      }, 2500);
      transaction.oncomplete = () => { clearTimeout(timer); resolve(request.result); };
      transaction.onabort = () => { clearTimeout(timer); reject(transaction.error || new Error("Credential storage aborted")); };
      transaction.onerror = () => { clearTimeout(timer); reject(transaction.error); };
    });
  } finally { db.close(); }
}

// Serialize reads, writes and opt-out within the page, including slow restores.
let queue: Promise<unknown> = Promise.resolve();
function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation);
  queue = result.catch(() => undefined);
  return result;
}

function removeLegacyFlag() {
  try { localStorage.removeItem("datatalk-remember-password"); } catch { /* Storage may be disabled. */ }
}

export function readRememberedLogin(): Promise<Login | null> {
  return serialized(async () => {
    const saved = await access<SavedLogin | undefined>("readonly", (store) => store.get(ENTRY));
    if (!saved) { removeLegacyFlag(); return null; }
    try {
      if (saved.version !== 1 || !Number.isFinite(saved.expiresAt) || saved.expiresAt <= Date.now()) throw new Error("Expired credential");
      const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: saved.iv }, saved.key, saved.ciphertext);
      const login = JSON.parse(new TextDecoder().decode(plaintext)) as Login;
      if (typeof login.username !== "string" || !login.username || typeof login.password !== "string" || !login.password) throw new Error("Invalid credential");
      return login;
    } catch {
      await access("readwrite", (store) => store.delete(ENTRY));
      removeLegacyFlag();
      return null;
    }
  });
}

export function saveRememberedLogin(login: Login): Promise<void> {
  return serialized(async () => {
    // A fresh, non-exportable key and IV for each successful login. Store the
    // complete record atomically so an interrupted save cannot mismatch keys.
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(JSON.stringify(login)));
    const saved: SavedLogin = { version: 1, key, iv, ciphertext, expiresAt: Date.now() + MAX_AGE };
    await access("readwrite", (store) => store.put(saved, ENTRY));
    removeLegacyFlag();
  });
}

export function clearRememberedLogin(): Promise<void> {
  return serialized(async () => {
    removeLegacyFlag();
    await access("readwrite", (store) => store.delete(ENTRY));
  });
}
