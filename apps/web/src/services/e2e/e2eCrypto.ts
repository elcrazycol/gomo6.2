import {
  loadLibsignal,
  getKeyHelper,
  getSessionBuilder,
  getSessionCipher,
  getSignalProtocolAddress,
} from "./libsignalLoader";
import {
  getIdentityKeyPair as dbGetIdentityKeyPair,
  getSignedPreKey as dbGetSignedPreKey,
  getOneTimePreKeys as dbGetOneTimePreKeys,
  removeOneTimePreKey as dbRemoveOneTimePreKey,
  saveSession as dbSaveSession,
  getAllSessions as dbGetAllSessions,
} from "./e2eKeyStorage";
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

// ─── Write-through store base ────────────────────────────────────────────────
// libsignal calls store methods synchronously during encrypt/decrypt.
// IndexedDB is async. Solution: in-memory Map as source of truth (sync reads),
// write-through to IndexedDB on every mutation (async, non-blocking).

abstract class WriteThroughStore<T> {
  protected store: Map<string, T> = new Map();
  private initPromise: Promise<void> | null = null;
  private ready = false;

  protected abstract loadFromDB(): Promise<[string, T][]>;
  protected abstract saveToDB(key: string, value: T): Promise<void>;
  protected abstract deleteFromDB(key: string): Promise<void>;

  private async ensureReady(): Promise<void> {
    if (this.ready) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        const entries = await this.loadFromDB();
        for (const [k, v] of entries) {
          this.store.set(k, v);
        }
        this.ready = true;
      })();
    }
    return this.initPromise;
  }

  async get(key: string): Promise<T | undefined> {
    await this.ensureReady();
    return this.store.get(key);
  }

  async put(key: string, value: T): Promise<void> {
    await this.ensureReady();
    this.store.set(key, value);
    this.saveToDB(key, value).catch(() => { /* background write */ });
  }

  async delete(key: string): Promise<void> {
    await this.ensureReady();
    this.store.delete(key);
    this.deleteFromDB(key).catch(() => { /* background write */ });
  }

  getSync(key: string): T | undefined {
    return this.store.get(key);
  }

  getAllSync(): Map<string, T> {
    return this.store;
  }
}

// ─── Signal Protocol stores (write-through to IndexedDB) ────────────────────

class SignalIdentityStore extends WriteThroughStore<{ pubKey: ArrayBuffer; privKey: ArrayBuffer }> {
  protected async loadFromDB(): Promise<[string, { pubKey: ArrayBuffer; privKey: ArrayBuffer }][]> {
    return [];
  }
  protected async saveToDB(): Promise<void> { /* identity is saved via e2eKeyStorage directly */ }
  protected async deleteFromDB(): Promise<void> { /* identity persists */ }

  // libsignal uses these for identity management
  async getRecord(identifier: string): Promise<{ pubKey: ArrayBuffer; privKey: ArrayBuffer } | undefined> {
    return this.getSync(identifier);
  }

  async putRecord(identifier: string, record: { pubKey: ArrayBuffer; privKey: ArrayBuffer }): Promise<void> {
    await this.put(identifier, record);
  }

  async removeRecord(identifier: string): Promise<void> {
    await this.delete(identifier);
  }

  async isTrustedIdentity(_identifier: string, _identityKey: unknown, _direction: unknown): Promise<boolean> {
    return true;
  }

  async saveIdentity(_identifier: string, _identityKey: unknown): Promise<boolean> {
    return false;
  }
}

class SignalPreKeyStore extends WriteThroughStore<{ pubKey: ArrayBuffer; privKey: ArrayBuffer }> {
  protected async loadFromDB(): Promise<[string, { pubKey: ArrayBuffer; privKey: ArrayBuffer }][]> {
    const opks = await dbGetOneTimePreKeys();
    return opks.map((k) => [String(k.keyId), { pubKey: k.publicKey, privKey: k.privateKey }]);
  }

  protected async saveToDB(_key: string, _value: { pubKey: ArrayBuffer; privKey: ArrayBuffer }): Promise<void> {
    // OPKs are managed via e2eKeyStorage directly — this is mainly for in-memory session state
  }

  protected async deleteFromDB(key: string): Promise<void> {
    const allKeys = await dbGetOneTimePreKeys();
    const match = allKeys.find((k) => String(k.keyId) === key);
    if (match) {
      await dbRemoveOneTimePreKey(match.id);
    }
  }

  async getPreKey(keyId: number): Promise<{ pubKey: ArrayBuffer; privKey: ArrayBuffer }> {
    const key = this.getSync(String(keyId));
    if (!key) throw new Error(`Pre-key ${keyId} not found`);
    return key;
  }

  async savePreKey(keyId: number, keyPair: { pubKey: ArrayBuffer; privKey: ArrayBuffer }): Promise<void> {
    await this.put(String(keyId), keyPair);
  }

  async removePreKey(keyId: number): Promise<void> {
    await this.delete(String(keyId));
  }
}

class SignalSignedPreKeyStore extends WriteThroughStore<{ pubKey: ArrayBuffer; privKey: ArrayBuffer; signature: ArrayBuffer }> {
  protected async loadFromDB(): Promise<[string, { pubKey: ArrayBuffer; privKey: ArrayBuffer; signature: ArrayBuffer }][] > {
    // Signed pre-key is loaded separately via loadAllKeyMaterial
    return [];
  }
  protected async saveToDB(): Promise<void> { /* SPK is saved via e2eKeyStorage directly */ }
  protected async deleteFromDB(): Promise<void> { /* SPK persists */ }

  async getSignedPreKey(keyId: number): Promise<{ pubKey: ArrayBuffer; privKey: ArrayBuffer; signature: ArrayBuffer }> {
    const key = this.getSync(String(keyId));
    if (!key) throw new Error(`Signed pre-key ${keyId} not found`);
    return key;
  }

  async saveSignedPreKey(keyId: number, keyPair: { pubKey: ArrayBuffer; privKey: ArrayBuffer; signature: ArrayBuffer }): Promise<void> {
    await this.put(String(keyId), keyPair);
  }

  async removeSignedPreKey(_keyId: number): Promise<void> {
    // SPK is not removed
  }
}

class SignalSessionStore extends WriteThroughStore<Record<number, unknown>> {
  protected async loadFromDB(): Promise<[string, Record<number, unknown>][]> {
    const sessions = await dbGetAllSessions();
    return sessions.map((s) => [s.conversationId, s.sessions as Record<number, unknown>]);
  }

  protected async saveToDB(key: string, value: Record<number, unknown>): Promise<void> {
    await dbSaveSession({ conversationId: key, sessions: value });
  }

  protected async deleteFromDB(key: string): Promise<void> {
    // Sessions persist — deletion not critical
  }

  async getSessions(name: string): Promise<Record<number, unknown>> {
    return this.getSync(name) || {};
  }

  async putSession(name: string, number_: number, record: unknown): Promise<boolean> {
    const sessions = this.getSync(name) || {};
    sessions[number_] = record;
    await this.put(name, sessions);
    return true;
  }
}

// ─── Global store instances ──────────────────────────────────────────────────

export const identityStore = new SignalIdentityStore();
export const preKeyStore = new SignalPreKeyStore();
export const signedPreKeyStore = new SignalSignedPreKeyStore();
export const sessionStore = new SignalSessionStore();

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

// ─── Load all key material from IndexedDB into in-memory stores ──────────────

let currentIdentityKeyPair: GeneratedKeyPair | null = null;

export function getCurrentIdentityKeyPair(): GeneratedKeyPair | null {
  return currentIdentityKeyPair;
}

export async function loadAllKeyMaterial(deviceId: string): Promise<void> {
  // Load identity key pair
  const ikp = await dbGetIdentityKeyPair(deviceId);
  if (ikp) {
    currentIdentityKeyPair = { pubKey: ikp.publicKey, privKey: ikp.privateKey };
    // Populate identity store for libsignal
    await identityStore.put(deviceId, { pubKey: ikp.publicKey, privKey: ikp.privateKey });
  }

  // Load signed pre-key
  const spk = await dbGetSignedPreKey(deviceId);
  if (spk) {
    await signedPreKeyStore.put(String(spk.keyId), {
      pubKey: spk.publicKey,
      privKey: spk.privateKey,
      signature: spk.signature,
    });
  }

  // Load one-time pre-keys
  const opks = await dbGetOneTimePreKeys();
  for (const opk of opks) {
    await preKeyStore.put(String(opk.keyId), {
      pubKey: opk.publicKey,
      privKey: opk.privateKey,
    });
  }

  // Load sessions
  // Sessions are loaded lazily from IndexedDB via the sessionStore's loadFromDB
  // but we can also pre-load them for known conversations
  // This is handled lazily — sessionStore.get() triggers loadFromDB on first call
}

// ─── Save session to IndexedDB after ratchet mutations ───────────────────────

export async function persistSessionState(name: string): Promise<void> {
  const sessions = sessionStore.getSync(name);
  if (sessions) {
    await dbSaveSession({ conversationId: name, sessions });
  }
}

// ─── Key Exchange (X3DH) ─────────────────────────────────────────────────────

function getAddress(name: string, deviceId: number) {
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

  // Persist session after key exchange
  const sessionId = `${addressName}.${theirDeviceId}`;
  await persistSessionState(addressName);

  return { sessionId };
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

  // Persist session state after encryption (Double Ratchet mutation)
  await persistSessionState(addressName);

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

  // Persist session state after decryption (Double Ratchet mutation + possible new session from type 3)
  await persistSessionState(addressName);

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
