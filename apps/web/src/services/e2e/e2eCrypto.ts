import {
  loadLibsignal,
  getKeyHelper,
  getSessionBuilder,
  getSessionCipher,
  getSignalProtocolAddress,
} from "./libsignalLoader";
import type { CiphertextEntry } from "@/components/messenger/types";

// ─── ArrayBuffer helpers ─────────────────────────────────────────────────────

function ab2hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hex2ab(hex: string): ArrayBuffer {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes.buffer;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

// ─── Simple in-memory session store for libsignal-protocol ────────────────────

class SignalSessionStore {
  private store: Map<string, unknown> = new Map();

  async getRecord(identifier: string): Promise<unknown | undefined> {
    return this.store.get(identifier);
  }

  async putRecord(identifier: string, record: unknown): Promise<void> {
    this.store.set(identifier, record);
  }

  async removeRecord(identifier: string): Promise<void> {
    this.store.delete(identifier);
  }

  async isTrustedIdentity(
    _identifier: string,
    _identityKey: unknown,
    _direction: unknown
  ): Promise<boolean> {
    // For MVP: always trust. In production, implement safety number verification.
    return true;
  }

  async saveIdentity(_identifier: string, _identityKey: unknown): Promise<boolean> {
    return false;
  }
}

class SignalPreKeyStore {
  private store: Map<number, { pubKey: ArrayBuffer; privKey: ArrayBuffer }> =
    new Map();

  async getPreKey(keyId: number): Promise<{ pubKey: ArrayBuffer; privKey: ArrayBuffer }> {
    const key = this.store.get(keyId);
    if (!key) throw new Error(`Pre-key ${keyId} not found`);
    return key;
  }

  async savePreKey(
    keyId: number,
    keyPair: { pubKey: ArrayBuffer; privKey: ArrayBuffer }
  ): Promise<void> {
    this.store.set(keyId, keyPair);
  }

  async removePreKey(keyId: number): Promise<void> {
    this.store.delete(keyId);
  }
}

class SignalSignedPreKeyStore {
  private store: Map<
    number,
    { pubKey: ArrayBuffer; privKey: ArrayBuffer; signature: ArrayBuffer }
  > = new Map();

  async getSignedPreKey(
    keyId: number
  ): Promise<{ pubKey: ArrayBuffer; privKey: ArrayBuffer; signature: ArrayBuffer }> {
    const key = this.store.get(keyId);
    if (!key) throw new Error(`Signed pre-key ${keyId} not found`);
    return key;
  }

  async saveSignedPreKey(
    keyId: number,
    keyPair: { pubKey: ArrayBuffer; privKey: ArrayBuffer; signature: ArrayBuffer }
  ): Promise<void> {
    this.store.set(keyId, keyPair);
  }

  async removeSignedPreKey(_keyId: number): Promise<void> {
    this.store.delete(_keyId);
  }
}

class SignalSessionStore2 {
  private store: Map<string, { [key: number]: unknown }> = new Map();

  async getSessions(name: string): Promise<{ [key: number]: unknown }> {
    return this.store.get(name) || {};
  }

  async putSession(
    name: string,
    number_: number,
    record: unknown
  ): Promise<boolean> {
    const sessions = this.store.get(name) || {};
    sessions[number_] = record;
    this.store.set(name, sessions);
    return true;
  }
}

// ─── Key Generation ──────────────────────────────────────────────────────────

export interface GeneratedKeyPair {
  pubKey: ArrayBuffer;
  privKey: ArrayBuffer;
}

export interface GeneratedSignedPreKey {
  keyId: number;
  keyPair: GeneratedKeyPair;
  signature: ArrayBuffer;
}

export interface GeneratedPreKey {
  keyId: number;
  keyPair: GeneratedKeyPair;
}

export async function generateIdentityKeyPair(): Promise<GeneratedKeyPair> {
  await loadLibsignal();
  return getKeyHelper().generateIdentityKeyPair();
}

export async function generateSignedPreKey(
  identityKeyPair: GeneratedKeyPair,
  keyId: number = 1
): Promise<GeneratedSignedPreKey> {
  await loadLibsignal();
  return getKeyHelper().generateSignedPreKey(identityKeyPair, keyId);
}

export async function generatePreKeys(
  startId: number,
  count: number
): Promise<GeneratedPreKey[]> {
  await loadLibsignal();
  const keys: GeneratedPreKey[] = [];
  for (let i = 0; i < count; i++) {
    keys.push(await getKeyHelper().generatePreKey(startId + i));
  }
  return keys;
}

export async function generateRegistrationId(): Promise<number> {
  await loadLibsignal();
  return getKeyHelper().generateRegistrationId();
}

// ─── Key Exchange (X3DH) ─────────────────────────────────────────────────────

const identityStore = new SignalSessionStore();
const preKeyStore = new SignalPreKeyStore();
const signedPreKeyStore = new SignalSignedPreKeyStore();
const sessionStore = new SignalSessionStore2();

function getAddress(
  name: string,
  deviceId: number
) {
  return getSignalProtocolAddress(name, deviceId);
}

function getStorage() {
  return {
    Direction: { SENDING: 1, RECEIVING: 2 },
    isTrustedIdentity: identityStore.isTrustedIdentity.bind(identityStore),
    saveIdentity: identityStore.saveIdentity.bind(identityStore),
    getRecord: identityStore.getRecord.bind(identityStore),
    putRecord: identityStore.putRecord.bind(identityStore),
    removeRecord: identityStore.removeRecord.bind(identityStore),
    getPreKey: preKeyStore.getPreKey.bind(preKeyStore),
    savePreKey: preKeyStore.savePreKey.bind(preKeyStore),
    removePreKey: preKeyStore.removePreKey.bind(preKeyStore),
    getSignedPreKey: signedPreKeyStore.getSignedPreKey.bind(signedPreKeyStore),
    saveSignedPreKey: signedPreKeyStore.saveSignedPreKey.bind(signedPreKeyStore),
    removeSignedPreKey: signedPreKeyStore.removeSignedPreKey.bind(signedPreKeyStore),
    getSessions: sessionStore.getSessions.bind(sessionStore),
    putSession: sessionStore.putSession.bind(sessionStore),
  };
}

export async function performKeyExchange(
  theirIdentityKey: ArrayBuffer,
  theirSignedPreKey: ArrayBuffer,
  theirOneTimePreKey: ArrayBuffer | null,
  theirRegistrationId: number,
  theirDeviceId: number,
  _ourIdentityKeyPair: GeneratedKeyPair,
  addressName: string
): Promise<{ sessionId: string }> {
  await loadLibsignal();
  const address = getAddress(addressName, theirDeviceId);
  const storage = getStorage();
  const builder = getSessionBuilder(storage, address);

  const preKeyBundle: Record<string, unknown> = {
    identityKey: theirIdentityKey,
    registrationId: theirRegistrationId,
    signedPreKey: {
      keyId: 1,
      publicKey: theirSignedPreKey,
      signature: new ArrayBuffer(0),
    },
  };
  if (theirOneTimePreKey) {
    (preKeyBundle.preKey as Record<string, unknown>) = {
      keyId: 1,
      publicKey: theirOneTimePreKey,
    };
  }

  await builder.processPreKey(preKeyBundle);

  return {
    sessionId: `${addressName}.${theirDeviceId}`,
  };
}

// ─── Encryption / Decryption ─────────────────────────────────────────────────

export async function encryptMessage(
  plaintext: string,
  addressName: string,
  deviceId: number
): Promise<{ ciphertext: string; type: number }> {
  await loadLibsignal();
  const address = getAddress(addressName, deviceId);
  const storage = getStorage();
  const cipher = getSessionCipher(storage, address);

  const plaintextBuffer = new TextEncoder().encode(plaintext).buffer;
  const cipherMessage = await cipher.encrypt(plaintextBuffer);

  return {
    ciphertext: JSON.stringify({
      type: cipherMessage.type,
      body: arrayBufferToBase64(cipherMessage.body),
    }),
    type: cipherMessage.type,
  };
}

export async function decryptMessage(
  ciphertextBase64: string,
  addressName: string,
  deviceId: number
): Promise<string> {
  await loadLibsignal();
  const address = getAddress(addressName, deviceId);
  const storage = getStorage();
  const cipher = getSessionCipher(storage, address);

  const cipherData = JSON.parse(ciphertextBase64);
  const cipherMessage = {
    type: cipherData.type,
    body: base64ToArrayBuffer(cipherData.body),
  };

  let plainBuffer: ArrayBuffer;

  if (cipherMessage.type === 3) {
    plainBuffer = await cipher.decryptPreKeyWhisperMessage(cipherMessage.body);
  } else {
    plainBuffer = await cipher.decryptWhisperMessage(cipherMessage.body);
  }

  return new TextDecoder().decode(new Uint8Array(plainBuffer));
}

// ─── Serialization helpers ───────────────────────────────────────────────────

export function keyPairToHex(
  keyPair: GeneratedKeyPair
): { publicKeyHex: string; privateKeyHex: string } {
  return {
    publicKeyHex: ab2hex(keyPair.pubKey),
    privateKeyHex: ab2hex(keyPair.privKey),
  };
}

export function hexToKeyPair(
  publicKeyHex: string,
  privateKeyHex: string
): GeneratedKeyPair {
  return {
    pubKey: hex2ab(publicKeyHex),
    privKey: hex2ab(privateKeyHex),
  };
}

export function bufferToBase64(buf: ArrayBuffer): string {
  return arrayBufferToBase64(buf);
}

export function base64ToBuffer(b64: string): ArrayBuffer {
  return base64ToArrayBuffer(b64);
}

export { CiphertextEntry };
