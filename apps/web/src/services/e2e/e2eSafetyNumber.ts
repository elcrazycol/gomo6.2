import { loadLibsignal, getFingerprintGenerator } from "./libsignalLoader";
import { getIdentityKeyPair } from "./e2eKeyStorage";
import { getDeviceId } from "./e2eKeyStorage";
import * as e2eApi from "./e2eApi";

// ─── Emoji set for fingerprint display ───────────────────────────────────────
// Signal uses digits 0-9 mapped to specific emojis for visual comparison
const FINGERPRINT_EMOJIS = ["0️⃣", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];

// ─── Safety Number Generation ────────────────────────────────────────────────

export interface SafetyNumber {
  /** 60-digit numeric string (Signal format) */
  numeric: string;
  /** 12 groups of 5 digits for display */
  groups: string[];
  /** 12 emoji derived from digit pairs */
  emoji: string[];
}

export async function generateSafetyNumber(
  localUserId: string,
  remoteUserId: string
): Promise<SafetyNumber | null> {
  await loadLibsignal();

  // Get local identity key
  const deviceId = getDeviceId();
  const localKeyPair = await getIdentityKeyPair(deviceId);
  if (!localKeyPair) return null;

  // Get remote identity key from server
  const bundle = await e2eApi.fetchKeyBundle(remoteUserId);
  if (!bundle.devices || bundle.devices.length === 0) return null;

  const remoteIdentityKeyB64 = bundle.devices[0].public_identity_key;
  const remoteIdentityKey = base64ToBuffer(remoteIdentityKeyB64);

  // Generate fingerprint using Signal's algorithm
  const FingerprintGenerator = getFingerprintGenerator();
  const fingerprint = await FingerprintGenerator.createFor(
    localUserId,
    localKeyPair.publicKey,
    remoteUserId,
    remoteIdentityKey
  );

  // Parse into display format
  const numeric = fingerprint.toString().replace(/\s/g, "");
  const groups: string[] = [];
  for (let i = 0; i < numeric.length; i += 5) {
    groups.push(numeric.slice(i, i + 5));
  }

  // Derive emoji from digit pairs
  const emoji: string[] = [];
  for (let i = 0; i < numeric.length; i += 2) {
    const pair = parseInt(numeric.slice(i, i + 2), 10);
    emoji.push(FINGERPRINT_EMOJIS[pair % 10]);
  }

  return { numeric, groups, emoji: emoji.slice(0, 12) };
}

// ─── Verification State (IndexedDB) ─────────────────────────────────────────

const VERIFIED_STORE = "verified_identities";

interface VerifiedIdentity {
  conversationId: string;
  remoteUserId: string;
  verifiedAt: string;
  safetyNumberHash: string;
}

async function openVerifiedDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("e2e_keys", 1);
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
  const encoder = new TextEncoder();
  const data = encoder.encode(numeric);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  return Array.from(hashArray)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
