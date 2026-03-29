"use client";

import libsignal, {
  KeyHelper,
  SessionBuilder,
  SessionCipher,
  SignalProtocolAddress,
  type Direction,
  type KeyPairType,
  type StorageType,
} from "libsignal-protocol-typescript";
import { textDecoder, textEncoder } from "@/lib/encoding";

const DB_NAME = "gomo6-messenger-e2ee";
const DB_VERSION = 1;
const STORE_NAME = "kv";
const DEVICE_KEY = "device-state";
const SENT_CACHE_KEY = "sent-cache";
const MESSAGE_CACHE_KEY = "message-cache";

type LocalDeviceState = {
  version: 1;
  userId: string;
  clientDeviceId: string;
  signalDeviceId: number | null;
  registrationId: number;
  identityKeyPair: {
    pubKey: string;
    privKey: string;
  };
  signedPreKeyId: number;
  signedPreKey: {
    pubKey: string;
    privKey: string;
    signature: string;
  };
  preKeys: Record<string, { pubKey: string; privKey: string }>;
  sessions: Record<string, string>;
  identities: Record<string, string>;
};

type UploadBundle = {
  clientDeviceId: string;
  signalDeviceId: number | null;
  registrationId: number;
  deviceLabel: string;
  identityPublicKey: string;
  signedPreKeyId: number;
  signedPreKeyPublic: string;
  signedPreKeySignature: string;
  kyberPreKeyId: number;
  kyberPreKeyPublic: string;
  kyberPreKeySignature: string;
  oneTimePreKeys: Array<{ preKeyId: number; publicKey: string }>;
};

type SentCache = Record<string, string>;
type MessageCache = Record<string, string>;

const toBase64 = (bytes: Uint8Array | ArrayBuffer) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64");
const fromBase64 = (value: string) => Buffer.from(value, "base64").buffer.slice(
  Buffer.from(value, "base64").byteOffset,
  Buffer.from(value, "base64").byteOffset + Buffer.from(value, "base64").byteLength
);
const binaryStringToBase64 = (value: string) => Buffer.from(value, "binary").toString("base64");

const serializeKeyPair = (pair: KeyPairType<ArrayBuffer>) => ({
  pubKey: toBase64(pair.pubKey),
  privKey: toBase64(pair.privKey),
});

const deserializeKeyPair = (pair: { pubKey: string; privKey: string }): KeyPairType<ArrayBuffer> => ({
  pubKey: fromBase64(pair.pubKey),
  privKey: fromBase64(pair.privKey),
});

let libsignalReady: Promise<void> | null = null;

const ensureLibsignalReady = async () => {
  if (!libsignalReady) {
    libsignalReady = (async () => {
      await libsignal();
    })();
  }
  await libsignalReady;
};

const openDb = async () => {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
};

const readValue = async <T>(key: string): Promise<T | null> => {
  const db = await openDb();
  return await new Promise<T | null>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
  });
};

const writeValue = async <T>(key: string, value: T) => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).put(value, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("IndexedDB write failed"));
  });
};

const deleteValue = async (key: string) => {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const request = transaction.objectStore(STORE_NAME).delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("IndexedDB delete failed"));
  });
};

const createInitialState = async (userId: string): Promise<LocalDeviceState> => {
  await ensureLibsignalReady();
  const identityKeyPair = await KeyHelper.generateIdentityKeyPair();
  const registrationId = KeyHelper.generateRegistrationId();
  const signedPreKeyId = 1;
  const signedPreKey = await KeyHelper.generateSignedPreKey(identityKeyPair, signedPreKeyId);
  const preKeys: LocalDeviceState["preKeys"] = {};

  for (let id = 1; id <= 25; id += 1) {
    const preKey = await KeyHelper.generatePreKey(id);
    preKeys[String(preKey.keyId)] = serializeKeyPair(preKey.keyPair);
  }

  return {
    version: 1,
    userId,
    clientDeviceId: crypto.randomUUID(),
    signalDeviceId: null,
    registrationId,
    identityKeyPair: serializeKeyPair(identityKeyPair),
    signedPreKeyId,
    signedPreKey: {
      ...serializeKeyPair(signedPreKey.keyPair),
      signature: toBase64(signedPreKey.signature),
    },
    preKeys,
    sessions: {},
    identities: {},
  };
};

export const ensureLocalDeviceState = async (userId: string) => {
  const current = await readValue<LocalDeviceState>(DEVICE_KEY);
  if (current?.userId === userId) {
    return current;
  }

  const created = await createInitialState(userId);
  await writeValue(DEVICE_KEY, created);
  return created;
};

export const updateSignalDeviceAssignment = async (signalDeviceId: number) => {
  const current = await readValue<LocalDeviceState>(DEVICE_KEY);
  if (!current) return null;
  const next = { ...current, signalDeviceId };
  await writeValue(DEVICE_KEY, next);
  return next;
};

export const buildUploadBundle = (state: LocalDeviceState): UploadBundle => ({
  clientDeviceId: state.clientDeviceId,
  signalDeviceId: state.signalDeviceId,
  registrationId: state.registrationId,
  deviceLabel: "browser",
  identityPublicKey: state.identityKeyPair.pubKey,
  signedPreKeyId: state.signedPreKeyId,
  signedPreKeyPublic: state.signedPreKey.pubKey,
  signedPreKeySignature: state.signedPreKey.signature,
  kyberPreKeyId: 1,
  kyberPreKeyPublic: state.identityKeyPair.pubKey,
  kyberPreKeySignature: "",
  oneTimePreKeys: Object.entries(state.preKeys).map(([preKeyId, keyPair]) => ({
    preKeyId: Number(preKeyId),
    publicKey: keyPair.pubKey,
  })),
});

class BrowserSignalStore implements StorageType {
  constructor(private readonly state: LocalDeviceState) {}

  async getIdentityKeyPair() {
    return deserializeKeyPair(this.state.identityKeyPair);
  }

  async getLocalRegistrationId() {
    return this.state.registrationId;
  }

  async isTrustedIdentity(identifier: string, identityKey: ArrayBuffer, _direction: Direction) {
    const known = this.state.identities[identifier];
    return !known || known === toBase64(identityKey);
  }

  async saveIdentity(encodedAddress: string, publicKey: ArrayBuffer) {
    const serialized = toBase64(publicKey);
    const changed = this.state.identities[encodedAddress] !== serialized;
    this.state.identities[encodedAddress] = serialized;
    await writeValue(DEVICE_KEY, this.state);
    return changed;
  }

  async loadPreKey(keyId: string | number) {
    const pair = this.state.preKeys[String(keyId)];
    return pair ? deserializeKeyPair(pair) : undefined;
  }

  async storePreKey(keyId: string | number, keyPair: KeyPairType<ArrayBuffer>) {
    this.state.preKeys[String(keyId)] = serializeKeyPair(keyPair);
    await writeValue(DEVICE_KEY, this.state);
  }

  async removePreKey(keyId: string | number) {
    delete this.state.preKeys[String(keyId)];
    await writeValue(DEVICE_KEY, this.state);
  }

  async storeSession(encodedAddress: string, record: string) {
    this.state.sessions[encodedAddress] = record;
    await writeValue(DEVICE_KEY, this.state);
  }

  async loadSession(encodedAddress: string) {
    return this.state.sessions[encodedAddress];
  }

  async loadSignedPreKey(keyId: string | number) {
    if (Number(keyId) !== this.state.signedPreKeyId) return undefined;
    return deserializeKeyPair(this.state.signedPreKey);
  }

  async storeSignedPreKey(keyId: string | number, keyPair: KeyPairType<ArrayBuffer>) {
    this.state.signedPreKeyId = Number(keyId);
    this.state.signedPreKey = {
      ...serializeKeyPair(keyPair),
      signature: this.state.signedPreKey.signature,
    };
    await writeValue(DEVICE_KEY, this.state);
  }

  async removeSignedPreKey(keyId: string | number) {
    if (Number(keyId) === this.state.signedPreKeyId) {
      this.state.signedPreKey = { pubKey: "", privKey: "", signature: "" };
      await writeValue(DEVICE_KEY, this.state);
    }
  }
}

const getStore = async (userId: string) => {
  await ensureLibsignalReady();
  const state = await ensureLocalDeviceState(userId);
  return {
    state,
    store: new BrowserSignalStore(state),
  };
};

export const buildSignalAddress = (userId: string, signalDeviceId: number) =>
  new SignalProtocolAddress(userId, signalDeviceId);

export const ensureSessionForDevice = async (
  userId: string,
  device: {
    userId: string;
    signalDeviceId: number;
    registrationId: number;
    identityPublicKey: string;
    signedPreKeyId: number;
    signedPreKeyPublic: string;
    signedPreKeySignature: string;
    oneTimePreKeyId: number | null;
    oneTimePreKeyPublic: string | null;
  }
) => {
  const { store } = await getStore(userId);
  const address = buildSignalAddress(device.userId, device.signalDeviceId);
  const cipher = new SessionCipher(store, address);
  if (await cipher.hasOpenSession()) {
    return { cipher, address };
  }

  const builder = new SessionBuilder(store, address);
  await builder.processPreKey({
    registrationId: device.registrationId,
    identityKey: fromBase64(device.identityPublicKey),
    signedPreKey: {
      keyId: device.signedPreKeyId,
      publicKey: fromBase64(device.signedPreKeyPublic),
      signature: fromBase64(device.signedPreKeySignature),
    },
    preKey:
      device.oneTimePreKeyId && device.oneTimePreKeyPublic
        ? {
            keyId: device.oneTimePreKeyId,
            publicKey: fromBase64(device.oneTimePreKeyPublic),
          }
        : undefined,
  });

  return { cipher, address };
};

export const encryptForDevice = async (
  userId: string,
  device: {
    userId: string;
    signalDeviceId: number;
    registrationId: number;
    identityPublicKey: string;
    signedPreKeyId: number;
    signedPreKeyPublic: string;
    signedPreKeySignature: string;
    oneTimePreKeyId: number | null;
    oneTimePreKeyPublic: string | null;
  },
  plainText: string
) => {
  const { cipher } = await ensureSessionForDevice(userId, device);
  const encrypted = await cipher.encrypt(textEncoder.encode(plainText).buffer);
  return {
    body:
      typeof encrypted.body === "string"
        ? binaryStringToBase64(encrypted.body)
        : toBase64(encrypted.body ?? new ArrayBuffer(0)),
    type: encrypted.type,
  };
};

export const decryptEnvelope = async (
  userId: string,
  senderUserId: string,
  senderSignalDeviceId: number,
  messageType: number,
  payload: string
) => {
  const { store } = await getStore(userId);
  const address = buildSignalAddress(senderUserId, senderSignalDeviceId);
  const cipher = new SessionCipher(store, address);
  const body = fromBase64(payload);
  const plaintext =
    messageType === 3
      ? await cipher.decryptPreKeyWhisperMessage(body, "binary")
      : await cipher.decryptWhisperMessage(body, "binary");

  return textDecoder.decode(new Uint8Array(plaintext));
};

export const cacheSentPlaintext = async (ciphertext: string, plainText: string) => {
  const current = (await readValue<SentCache>(SENT_CACHE_KEY)) ?? {};
  current[ciphertext] = plainText;
  await writeValue(SENT_CACHE_KEY, current);
};

export const getCachedSentPlaintext = async (ciphertext: string) => {
  const current = (await readValue<SentCache>(SENT_CACHE_KEY)) ?? {};
  return current[ciphertext] ?? null;
};

export const cacheMessagePlaintext = async (messageId: string, plainText: string) => {
  const current = (await readValue<MessageCache>(MESSAGE_CACHE_KEY)) ?? {};
  current[messageId] = plainText;
  await writeValue(MESSAGE_CACHE_KEY, current);
};

export const getCachedMessagePlaintext = async (messageId: string) => {
  const current = (await readValue<MessageCache>(MESSAGE_CACHE_KEY)) ?? {};
  return current[messageId] ?? null;
};

export const resetLocalE2EEState = async () => {
  await Promise.all([
    deleteValue(DEVICE_KEY),
    deleteValue(SENT_CACHE_KEY),
    deleteValue(MESSAGE_CACHE_KEY),
  ]);
};
