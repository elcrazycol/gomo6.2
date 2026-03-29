"use client";

import { textDecoder, textEncoder } from "@/lib/encoding";

const DB_NAME = "gomo6-messenger-e2ee";
const DB_VERSION = 1;
const STORE_NAME = "kv";
const DEVICE_KEY = "device-state";

type LocalDeviceState = {
  version: 1;
  userId: string;
  clientDeviceId: string;
  signalDeviceId: number | null;
  registrationId: number;
  publicKey: string;
  privateKeyJwk: JsonWebKey;
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

const randomRegistrationId = () => Math.floor(Math.random() * 16380) + 1;

const toBase64 = (bytes: Uint8Array | ArrayBuffer) => Buffer.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)).toString("base64");
const fromBase64 = (value: string) => new Uint8Array(Buffer.from(value, "base64"));

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

const exportPublicKey = async (key: CryptoKey) => toBase64(await crypto.subtle.exportKey("spki", key));

const createInitialState = async (userId: string): Promise<LocalDeviceState> => {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveBits"]
  );
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicKey = await exportPublicKey(keyPair.publicKey);

  return {
    version: 1,
    userId,
    clientDeviceId: crypto.randomUUID(),
    signalDeviceId: null,
    registrationId: randomRegistrationId(),
    publicKey,
    privateKeyJwk,
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
  identityPublicKey: state.publicKey,
  signedPreKeyId: 1,
  signedPreKeyPublic: state.publicKey,
  signedPreKeySignature: "",
  kyberPreKeyId: 1,
  kyberPreKeyPublic: state.publicKey,
  kyberPreKeySignature: "",
  oneTimePreKeys: [],
});

const importPrivateKey = async (state: LocalDeviceState) =>
  await crypto.subtle.importKey(
    "jwk",
    state.privateKeyJwk,
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveBits"]
  );

const importPublicKey = async (value: string) =>
  await crypto.subtle.importKey(
    "spki",
    fromBase64(value),
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    []
  );

const deriveAesKey = async (privateKey: CryptoKey, publicKey: CryptoKey) => {
  const bits = await crypto.subtle.deriveBits(
    {
      name: "ECDH",
      public: publicKey,
    },
    privateKey,
    256
  );

  return await crypto.subtle.importKey("raw", bits, "AES-GCM", false, ["encrypt", "decrypt"]);
};

export const encryptForDevice = async (plainText: string, recipientPublicKey: string) => {
  const ephemeral = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256",
    },
    true,
    ["deriveBits"]
  );
  const recipientKey = await importPublicKey(recipientPublicKey);
  const aesKey = await deriveAesKey(ephemeral.privateKey, recipientKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    aesKey,
    textEncoder.encode(plainText)
  );

  return JSON.stringify({
    version: 1,
    ephemeralPublicKey: await exportPublicKey(ephemeral.publicKey),
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext),
  });
};

export const decryptEnvelope = async (userId: string, payload: string) => {
  const state = await ensureLocalDeviceState(userId);
  const parsed = JSON.parse(payload) as {
    version: number;
    ephemeralPublicKey: string;
    iv: string;
    ciphertext: string;
  };

  const privateKey = await importPrivateKey(state);
  const publicKey = await importPublicKey(parsed.ephemeralPublicKey);
  const aesKey = await deriveAesKey(privateKey, publicKey);
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(parsed.iv),
    },
    aesKey,
    fromBase64(parsed.ciphertext)
  );

  return textDecoder.decode(decrypted);
};
