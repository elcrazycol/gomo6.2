// ─── Client-side end-to-end encryption for the personal "Заметки" (Notes) chat ──
//
// Security model: the AES-256-GCM key is generated on-device, stored ONLY in
// localStorage and NEVER sent to the server. Every note is encrypted locally
// before upload; the server stores the opaque ciphertext blob verbatim and
// never holds the key, so it cannot decrypt a note (defense-in-depth on top of
// the server-side at-rest encryption used for regular chats).
//
// Payload format: `e2enote1:` + base64(iv (12 bytes) || ciphertext + GCM tag).
// The conversation id is bound as authenticated additional data (AAD), so a
// ciphertext can never be replayed into another conversation.

const KEY_STORAGE = "gomo6:notes:key:v1";
const NOTES_MARKER = "e2enote1:";
const IV_LENGTH = 12;

export const NOTES_MARKER_PREFIX = NOTES_MARKER;

/** Shown when a note cannot be decrypted (missing/wrong key on this device). */
export const NOTES_LOCKED = "🔒 Заметки зашифрованы — ключ недоступен на этом устройстве";

let cachedKey: CryptoKey | null = null;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> | null {
  try {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function cryptoAvailable(): boolean {
  return typeof crypto !== "undefined" && typeof crypto.subtle !== "undefined" && typeof localStorage !== "undefined";
}

function encodeAad(conversationId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`gomo6:notes:${conversationId}`);
}

// Loads the device key without ever creating one. Reading notes must never
// silently mint a key: on a fresh device that only wants to restore a backup,
// auto-creation would hide the "restore" banner and leave a useless local key
// in the way (which is exactly what made cross-device restore confusing).
// Returns null when no key is stored yet.
async function loadKey(): Promise<CryptoKey | null> {
  if (cachedKey) return cachedKey;
  if (!cryptoAvailable()) return null;
  try {
    const stored = localStorage.getItem(KEY_STORAGE);
    if (stored) {
      const raw = hexToBytes(stored);
      if (raw && raw.length === 32) {
        cachedKey = await crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
        return cachedKey;
      }
    }
  } catch {
    // Corrupted key — treat as missing.
  }
  return null;
}

// Creates the device key on first use. Called only when the user actually
// WRITES a note (encryptNote / encryptNotesMeta) or explicitly asks for a key
// (ensureNotesKey) — never from decrypt or fingerprint paths.
async function loadOrCreateKey(): Promise<CryptoKey | null> {
  const existing = await loadKey();
  if (existing) return existing;

  const raw = crypto.getRandomValues(new Uint8Array(32));
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
  try {
    localStorage.setItem(KEY_STORAGE, bytesToHex(raw));
  } catch {
    // Private browsing may block storage; the session key still works.
  }
  cachedKey = key;
  return key;
}

/** True if a notes key exists on this device. */
export function hasNotesKey(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return Boolean(localStorage.getItem(KEY_STORAGE));
  } catch {
    return false;
  }
}

/** Ensures a key exists (generates one on first use) and returns it. */
export async function ensureNotesKey(): Promise<CryptoKey | null> {
  return loadOrCreateKey();
}

/**
 * Encrypts note plaintext for the given conversation. Returns the wire
 * payload (`e2enote1:` prefix + base64) that the server stores verbatim.
 * Throws if the Web Crypto API is unavailable.
 */
export async function encryptNote(plaintext: string, conversationId: string): Promise<string> {
  const key = await loadOrCreateKey();
  if (!key) throw new Error("Web Crypto API недоступен");
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encodeAad(conversationId) },
    key,
    new TextEncoder().encode(plaintext),
  );
  const blob = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  blob.set(iv, 0);
  blob.set(new Uint8Array(ciphertext), IV_LENGTH);
  return NOTES_MARKER + bytesToBase64(blob);
}

/**
 * Decrypts a notes payload. Returns the plaintext, or null when the payload is
 * not a note or cannot be decrypted (missing key, wrong key, tampered blob).
 */
export async function decryptNote(payload: string, conversationId: string): Promise<string | null> {
  if (!payload.startsWith(NOTES_MARKER)) return null;
  const key = await loadKey();
  if (!key) return null;
  try {
    const blob = base64ToBytes(payload.slice(NOTES_MARKER.length));
    if (!blob || blob.length <= IV_LENGTH) return null;
    const iv = new Uint8Array(blob.slice(0, IV_LENGTH));
    const ciphertext = new Uint8Array(blob.slice(IV_LENGTH));
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: encodeAad(conversationId) },
      key,
      ciphertext,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

/** Exports the device key as a 64-char hex string for backup/restore. */
export async function exportNotesKey(): Promise<string | null> {
  // Never mint a key just to export one — a fresh device without a key should
  // restore a backup, not silently generate a new one.
  const key = await loadKey();
  if (!key) return null;
  const raw = await crypto.subtle.exportKey("raw", key);
  return bytesToHex(new Uint8Array(raw));
}

/**
 * Imports a hex key (from a backup) and makes it the active device key.
 * Returns false when the input is not a valid 32-byte hex key.
 */
export async function importNotesKey(hex: string): Promise<boolean> {
  if (!cryptoAvailable()) return false;
  const raw = hexToBytes(hex.trim());
  if (!raw || raw.length !== 32) return false;
  try {
    const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", true, ["encrypt", "decrypt"]);
    try {
      localStorage.setItem(KEY_STORAGE, bytesToHex(raw));
    } catch {
      // Storage blocked — import still applies for this session.
    }
    cachedKey = key;
    return true;
  } catch {
    return false;
  }
}

// ─── Notes organization metadata (pin / folder / tags) ──────────────────────
// The same E2E scheme protects the per-note metadata: a small JSON object is
// encrypted with the device key + conversation AAD, and the server stores the
// opaque blob verbatim. Folder names and pin state are just as unreadable to
// the server as the note bodies themselves.

export type NotesMeta = {
  pinned?: boolean;
  folder?: string | null;
  tags?: string[];
};

/** Encrypts notes metadata for server storage. Returns the wire payload. */
export async function encryptNotesMeta(meta: NotesMeta, conversationId: string): Promise<string> {
  return encryptNote(JSON.stringify(meta), conversationId);
}

/**
 * Decrypts notes metadata. Returns null when absent, not a notes payload, or
 * unreadable (missing/wrong key, tampered blob).
 */
export async function decryptNotesMeta(
  payload: string | null | undefined,
  conversationId: string,
): Promise<NotesMeta | null> {
  if (!payload) return null;
  const plain = await decryptNote(payload, conversationId);
  if (!plain) return null;
  try {
    const parsed = JSON.parse(plain) as Partial<NotesMeta>;
    const meta: NotesMeta = {};
    if (typeof parsed.pinned === "boolean") meta.pinned = parsed.pinned;
    if (typeof parsed.folder === "string") meta.folder = parsed.folder;
    if (Array.isArray(parsed.tags)) {
      meta.tags = parsed.tags
        .filter((tag): tag is string => typeof tag === "string")
        .map((tag) => tag.trim())
        .filter((tag) => tag !== "");
    }
    return meta;
  } catch {
    return null;
  }
}

/** Short fingerprint of the active key (first 8 hex chars of SHA-256). */
export async function notesKeyFingerprint(): Promise<string | null> {
  const key = await loadKey();
  if (!key) return null;
  const raw = await crypto.subtle.exportKey("raw", key);
  const digest = await crypto.subtle.digest("SHA-256", raw);
  return bytesToHex(new Uint8Array(digest)).slice(0, 8);
}
