import * as e2eApi from "./e2eApi";

// ─── Signal Safety Number Algorithm (pure WebCrypto) ─────────────────────────
// Implements the same fingerprint generation as Signal Protocol without
// depending on the broken libsignal-protocol.js UMD bundle.

const VERSION = 0;

const FINGERPRINT_EMOJIS = [
  "0\uFE0F\u20E3", "1\uFE0F\u20E3", "2\uFE0F\u20E3", "3\uFE0F\u20E3", "4\uFE0F\u20E3",
  "5\uFE0F\u20E3", "6\uFE0F\u20E3", "7\uFE0F\u20E3", "8\uFE0F\u20E3", "9\uFE0F\u20E3",
];

function toBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function concat(...arrays: (ArrayBuffer | Uint8Array)[]): ArrayBuffer {
  const totalLength = arrays.reduce((sum, a) => sum + a.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(toBytes(arr), offset);
    offset += arr.byteLength;
  }
  return result.buffer;
}

async function sha512(data: ArrayBuffer): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-512", data);
}

async function iterateHash(
  data: ArrayBuffer,
  key: ArrayBuffer,
  count: number
): Promise<ArrayBuffer> {
  let current: ArrayBuffer = data;
  for (let i = 0; i < count; i++) {
    const combined = concat(current, key);
    current = await sha512(combined);
  }
  return current;
}

async function getDisplayString(
  identifier: string,
  identityKey: ArrayBuffer
): Promise<string> {
  const identifierBytes = new TextEncoder().encode(identifier);
  // VERSION as 2-byte Uint16Array (matches Signal's shortToArrayBuffer)
  const versionBuffer = new Uint16Array([VERSION]).buffer;

  // Data = VERSION(2 bytes) + identityKey + identifier
  const data = concat(versionBuffer, identityKey, identifierBytes);

  // Iterate hash 1000 times with data as both value and key
  const hash = await iterateHash(data, data, 1000);

  // Take first 30 bytes (offset 0,5,10,15,20,25), split into 6 chunks of 5 bytes
  // Each 5 bytes → 40 bits → format as 5-digit decimal
  const hashArray = new Uint8Array(hash);
  const chunks: string[] = [];
  for (let i = 0; i < 6; i++) {
    const offset = i * 5;
    // Read 5 bytes as big-endian number (matches Signal's getEncodedChunk)
    let value = 0;
    for (let j = 0; j < 5; j++) {
      value = (value * 256 + hashArray[offset + j]) % 100000;
    }
    chunks.push(value.toString().padStart(5, "0"));
  }
  return chunks.join("");
}

// ─── Safety Number Generation ────────────────────────────────────────────────

export interface SafetyNumber {
  numeric: string;
  groups: string[];
  emoji: string[];
}

export async function generateSafetyNumber(
  localUserId: string,
  remoteUserId: string
): Promise<SafetyNumber | null> {
  // Fetch BOTH users' public keys from the server
  // This ensures safety numbers match regardless of local key state
  const [localBundle, remoteBundle] = await Promise.all([
    e2eApi.fetchKeyBundle(localUserId),
    e2eApi.fetchKeyBundle(remoteUserId),
  ]);

  if (!localBundle.devices?.length || !remoteBundle.devices?.length) return null;

  const localIdentityKey = base64ToBuffer(localBundle.devices[0].public_identity_key);
  const remoteIdentityKey = base64ToBuffer(remoteBundle.devices[0].public_identity_key);

  const localString = await getDisplayString(localUserId, localIdentityKey);
  const remoteString = await getDisplayString(remoteUserId, remoteIdentityKey);

  const combined = [localString, remoteString].sort().join("");
  const numeric = combined;

  const groups: string[] = [];
  for (let i = 0; i < numeric.length; i += 5) {
    groups.push(numeric.slice(i, i + 5));
  }

  const emoji: string[] = [];
  for (let i = 0; i < numeric.length; i += 2) {
    const pair = parseInt(numeric.slice(i, i + 2), 10);
    emoji.push(FINGERPRINT_EMOJIS[pair % 10]);
  }

  return { numeric, groups, emoji: emoji.slice(0, 12) };
}

// ─── Verification State (IndexedDB) ─────────────────────────────────────────

const VERIFIED_STORE = "verified_identities";

async function openVerifiedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("e2e_keys", 2);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(VERIFIED_STORE)) {
        db.createObjectStore(VERIFIED_STORE, { keyPath: "conversationId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function isConversationVerified(
  conversationId: string
): Promise<boolean> {
  try {
    const db = await openVerifiedDB();
    return new Promise((resolve) => {
      const tx = db.transaction(VERIFIED_STORE, "readonly");
      const store = tx.objectStore(VERIFIED_STORE);
      const req = store.get(conversationId);
      req.onsuccess = () => resolve(!!req.result);
      req.onerror = () => resolve(false);
    });
  } catch {
    return false;
  }
}

export async function markConversationVerified(
  conversationId: string,
  remoteUserId: string,
  safetyNumberHash: string
): Promise<void> {
  const db = await openVerifiedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VERIFIED_STORE, "readwrite");
    const store = tx.objectStore(VERIFIED_STORE);
    const req = store.put({
      conversationId,
      remoteUserId,
      verifiedAt: new Date().toISOString(),
      safetyNumberHash,
    });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function removeVerification(
  conversationId: string
): Promise<void> {
  const db = await openVerifiedDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(VERIFIED_STORE, "readwrite");
    const store = tx.objectStore(VERIFIED_STORE);
    const req = store.delete(conversationId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function hashSafetyNumber(numeric: string): Promise<string> {
  const data = new TextEncoder().encode(numeric);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
