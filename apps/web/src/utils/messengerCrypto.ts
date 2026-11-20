// ─── Client-side E2E for 1:1 conversations (Phase 2 contract) ────────────────
//
// Wire format (opaque to the server): `e2e1:<alg>:<base64(iv || ciphertext)>`.
// Today `alg` is always `p256-aesgcm`: an ECDH P-256 shared secret between the
// two devices, used as a raw AES-256-GCM key. The conversation id + sender id
// are bound as AAD, so a blob can never be replayed into another conversation
// or forged by another sender.
//
// Key flow (per device):
//   1. `ensureE2EDevice()` generates an ECDH P-256 keypair once and stores the
//      private key locally (IndexedDB would be better; localStorage keeps the
//      Phase-2 footprint minimal and matches notesCrypto.ts).
//   2. The public key is published via PUT /api/v1/messenger/keys.
//   3. To talk E2E, each side fetches the peer's public key
//      (GET /api/v1/messenger/users/:id/keys) and derives the same AES-GCM key
//      locally. No private or shared secret ever leaves the device.
//
// Rust/other clients: implement the same steps with P-256 ECDH (e.g. p256 +
// aes-gcm crates), AAD `gomo6:e2e:<conversationId>:<senderId>`, 12-byte random
// IV prepended to the ciphertext, standard base64.

export const E2E_MARKER = "e2e1:";
export const E2E_ALG = "p256-aesgcm";
export const E2E_VERSION = 1;

const DEVICE_STORAGE = "gomo6:e2e:device:v1";
const IV_LENGTH = 12;

/** Shown when an E2E message cannot be decrypted on this device. */
export const E2E_LOCKED = "🔒 Сообщение зашифровано — ключ недоступен на этом устройстве";

type StoredDevice = {
  deviceId: string;
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
};

function cryptoAvailable(): boolean {
  return (
    typeof crypto !== "undefined" &&
    typeof crypto.subtle !== "undefined" &&
    typeof localStorage !== "undefined"
  );
}

function bytesToBase64(bytes: Uint8Array<ArrayBufferLike>): string {
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

function encodeAad(conversationId: string, senderId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(`gomo6:e2e:${conversationId}:${senderId}`);
}

function randomDeviceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function loadStoredDevice(): StoredDevice | null {
  try {
    const raw = localStorage.getItem(DEVICE_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDevice;
    if (!parsed.deviceId || !parsed.publicJwk || !parsed.privateJwk) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** This device's public key (JWK) for publishing to the key directory, or null. */
export async function getE2EDevicePublicJwk(): Promise<{ deviceId: string; publicJwk: JsonWebKey } | null> {
  if (!cryptoAvailable()) return null;
  const stored = loadStoredDevice();
  if (!stored) return null;
  return { deviceId: stored.deviceId, publicJwk: stored.publicJwk };
}

/**
 * Ensures a device identity exists (generates an ECDH P-256 keypair on first
 * use) and returns the device id + public JWK for publishing.
 */
export async function ensureE2EDevice(): Promise<{ deviceId: string; publicJwk: JsonWebKey } | null> {
  if (!cryptoAvailable()) return null;
  const stored = loadStoredDevice();
  if (stored) return { deviceId: stored.deviceId, publicJwk: stored.publicJwk };
  try {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"]);
    const [publicJwk, privateJwk] = await Promise.all([
      crypto.subtle.exportKey("jwk", pair.publicKey),
      crypto.subtle.exportKey("jwk", pair.privateKey),
    ]);
    const device: StoredDevice = { deviceId: randomDeviceId(), publicJwk, privateJwk };
    try {
      localStorage.setItem(DEVICE_STORAGE, JSON.stringify(device));
    } catch {
      // Private browsing: the session key still works.
    }
    return { deviceId: device.deviceId, publicJwk };
  } catch {
    return null;
  }
}

/** True when this device holds an E2E identity. */
export function hasE2EDevice(): boolean {
  if (typeof localStorage === "undefined") return false;
  try {
    return Boolean(localStorage.getItem(DEVICE_STORAGE));
  } catch {
    return false;
  }
}

async function deriveConversationKey(
  peerPublicJwk: JsonWebKey,
  conversationId: string,
): Promise<CryptoKey | null> {
  if (!cryptoAvailable()) return null;
  const stored = loadStoredDevice();
  if (!stored) return null;
  try {
    const [privateKey, peerKey] = await Promise.all([
      crypto.subtle.importKey("jwk", stored.privateJwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]),
      crypto.subtle.importKey("jwk", peerPublicJwk, { name: "ECDH", namedCurve: "P-256" }, false, []),
    ]);
    // The raw ECDH secret is bound to this conversation via HKDF, so the same
    // device pair gets an independent key per 1:1 chat.
    const secret = await crypto.subtle.deriveBits({ name: "ECDH", public: peerKey }, privateKey, 256);
    const hkdfKey = await crypto.subtle.importKey("raw", secret, "HKDF", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: new TextEncoder().encode(`gomo6:e2e-hkdf:${conversationId}`),
        info: new TextEncoder().encode("aes-256-gcm"),
      },
      hkdfKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  } catch {
    return null;
  }
}

/**
 * Encrypts plaintext for an E2E 1:1 conversation. Returns the opaque wire
 * payload (`e2e1:p256-aesgcm:<b64>`). Throws when crypto is unavailable or the
 * device has no identity yet.
 */
export async function encryptE2EMessage(
  plaintext: string,
  peerPublicJwk: JsonWebKey,
  conversationId: string,
  senderId: string,
): Promise<string> {
  const key = await deriveConversationKey(peerPublicJwk, conversationId);
  if (!key) throw new Error("E2E недоступен на этом устройстве");
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encodeAad(conversationId, senderId) },
    key,
    new TextEncoder().encode(plaintext),
  );
  const blob = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
  blob.set(iv, 0);
  blob.set(new Uint8Array(ciphertext), IV_LENGTH);
  return `${E2E_MARKER}${E2E_ALG}:${bytesToBase64(blob)}`;
}

/**
 * Decrypts an E2E payload. Returns the plaintext, or null when the payload is
 * not an E2E envelope or cannot be decrypted (no device key, unknown peer key,
 * tampered blob).
 */
export async function decryptE2EMessage(
  payload: string,
  peerPublicJwk: JsonWebKey,
  conversationId: string,
  senderId: string,
): Promise<string | null> {
  if (!payload.startsWith(E2E_MARKER)) return null;
  const rest = payload.slice(E2E_MARKER.length);
  const sep = rest.indexOf(":");
  if (sep <= 0) return null;
  if (rest.slice(0, sep) !== E2E_ALG) return null;
  const key = await deriveConversationKey(peerPublicJwk, conversationId);
  if (!key) return null;
  try {
    const blob = base64ToBytes(rest.slice(sep + 1));
    if (!blob || blob.length <= IV_LENGTH) return null;
    const iv = new Uint8Array(blob.slice(0, IV_LENGTH));
    const ciphertext = new Uint8Array(blob.slice(IV_LENGTH));
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(iv), additionalData: encodeAad(conversationId, senderId) },
      key,
      new Uint8Array(ciphertext),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return null;
  }
}

/** Parses the E2E envelope shape without decrypting. */
export function parseE2EEnvelope(payload: string): { v: number; alg: string } | null {
  if (!payload.startsWith(E2E_MARKER)) return null;
  const rest = payload.slice(E2E_MARKER.length);
  const sep = rest.indexOf(":");
  if (sep <= 0) return null;
  const alg = rest.slice(0, sep);
  if (alg !== E2E_ALG || !rest.slice(sep + 1)) return null;
  return { v: E2E_VERSION, alg };
}
