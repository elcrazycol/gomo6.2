const DB_NAME = "e2e_keys";
const DB_VERSION = 3;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("identity_keys")) {
        db.createObjectStore("identity_keys", { keyPath: "deviceId" });
      }
      if (!db.objectStoreNames.contains("signed_pre_keys")) {
        db.createObjectStore("signed_pre_keys", { keyPath: "deviceId" });
      }
      if (!db.objectStoreNames.contains("one_time_pre_keys")) {
        db.createObjectStore("one_time_pre_keys", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "conversationId" });
      }
      if (!db.objectStoreNames.contains("trusted_identities")) {
        db.createObjectStore("trusted_identities", { keyPath: "address" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// ─── Identity Key Pair ───────────────────────────────────────────────────────

export interface IdentityKeyPair {
  deviceId: string;
  publicKey: ArrayBuffer;
  privateKey: ArrayBuffer;
}

export async function getIdentityKeyPair(
  deviceId: string
): Promise<IdentityKeyPair | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("identity_keys", "readonly");
    const store = tx.objectStore("identity_keys");
    const req = store.get(deviceId);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveIdentityKeyPair(pair: IdentityKeyPair): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("identity_keys", "readwrite");
    const store = tx.objectStore("identity_keys");
    const req = store.put(pair);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ─── Signed Pre-Key ──────────────────────────────────────────────────────────

export interface SignedPreKey {
  deviceId: string;
  keyId: number;
  publicKey: ArrayBuffer;
  privateKey: ArrayBuffer;
  signature: ArrayBuffer;
}

export async function getSignedPreKey(
  deviceId: string
): Promise<SignedPreKey | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("signed_pre_keys", "readonly");
    const store = tx.objectStore("signed_pre_keys");
    const req = store.get(deviceId);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSignedPreKey(spk: SignedPreKey): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("signed_pre_keys", "readwrite");
    const store = tx.objectStore("signed_pre_keys");
    const req = store.put(spk);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ─── One-Time Pre-Keys ──────────────────────────────────────────────────────

export interface OneTimePreKey {
  id: string;
  keyId: number;
  publicKey: ArrayBuffer;
  privateKey: ArrayBuffer;
}

export async function getOneTimePreKeys(): Promise<OneTimePreKey[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("one_time_pre_keys", "readonly");
    const store = tx.objectStore("one_time_pre_keys");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

export async function removeOneTimePreKey(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("one_time_pre_keys", "readwrite");
    const store = tx.objectStore("one_time_pre_keys");
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function saveOneTimePreKeys(keys: OneTimePreKey[]): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("one_time_pre_keys", "readwrite");
    const store = tx.objectStore("one_time_pre_keys");
    for (const key of keys) {
      store.put(key);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ─── Sessions ────────────────────────────────────────────────────────────────

export interface StoredSession {
  conversationId: string;
  sessions: Record<string, unknown>; // Signal session record serialized
}

export async function getSession(
  conversationId: string
): Promise<StoredSession | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions", "readonly");
    const store = tx.objectStore("sessions");
    const req = store.get(conversationId);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSession(session: StoredSession): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions", "readwrite");
    const store = tx.objectStore("sessions");
    const req = store.put(session);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getAllSessions(): Promise<StoredSession[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("sessions", "readonly");
    const store = tx.objectStore("sessions");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result ?? []);
    req.onerror = () => reject(req.error);
  });
}

// ─── Device ID ───────────────────────────────────────────────────────────────

const DEVICE_ID_KEY = "e2e_device_id";
const REGISTRATION_ID_KEY = "e2e_registration_id";

export function getDeviceId(): string {
  let deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

// ─── Registration ID ────────────────────────────────────────────────────────

export function getRegistrationId(): number | null {
  const val = localStorage.getItem(REGISTRATION_ID_KEY);
  return val !== null ? parseInt(val, 10) : null;
}

export function saveRegistrationId(id: number): void {
  localStorage.setItem(REGISTRATION_ID_KEY, String(id));
}

// ─── Trusted Identities (TOFU) ──────────────────────────────────────────────

export interface TrustedIdentity {
  address: string;
  publicKey: string; // base64-encoded identity key
  firstSeenAt: string;
}

export async function getTrustedIdentity(address: string): Promise<TrustedIdentity | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("trusted_identities", "readonly");
    const store = tx.objectStore("trusted_identities");
    const req = store.get(address);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveTrustedIdentity(trusted: TrustedIdentity): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("trusted_identities", "readwrite");
    const store = tx.objectStore("trusted_identities");
    const req = store.put(trusted);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}
