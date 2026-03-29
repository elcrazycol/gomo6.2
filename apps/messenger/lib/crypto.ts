"use client";

const DB_NAME = "gomo6-messenger-secure-store";
const DB_VERSION = 2;
const STORE_NAME = "device";
const DEVICE_RECORD_KEY = "primary";
const LEGACY_KEY_STORAGE = "gomo6_messenger_device_v1";

let sodiumPromise: Promise<any> | null = null;
let openDbPromise: Promise<IDBDatabase> | null = null;

export type DeviceKeys = {
  deviceId: string;
  publicKey: string;
  privateKey: string;
};

type StoredDeviceRecord = {
  version: 1 | 2;
  deviceId?: string;
  publicKey: string;
  encryptedPrivateKey: string;
  iv: string;
  keyEncryptionKey: CryptoKey;
};

const toBase64 = (bytes: Uint8Array | ArrayBuffer) => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  view.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const fromBase64 = (value: string) => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const openDatabase = async () => {
  if (!openDbPromise) {
    openDbPromise = new Promise((resolve, reject) => {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    });
  }

  return openDbPromise;
};

const readRecord = async (): Promise<StoredDeviceRecord | null> => {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(DEVICE_RECORD_KEY);

    request.onsuccess = () => resolve((request.result as StoredDeviceRecord | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
  });
};

const writeRecord = async (record: StoredDeviceRecord) => {
  const db = await openDatabase();
  return new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(record, DEVICE_RECORD_KEY);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error ?? new Error("IndexedDB write failed"));
  });
};

const ensureDeviceId = async (record: StoredDeviceRecord) => {
  if (record.deviceId && record.deviceId.length >= 8) {
    return record.deviceId;
  }

  const deviceId = createDeviceId();
  await writeRecord({
    ...record,
    version: 2,
    deviceId,
  });

  return deviceId;
};

const createDeviceId = () => {
  const webCrypto = window.crypto as any;
  if (typeof webCrypto.randomUUID === "function") {
    return webCrypto.randomUUID();
  }

  const bytes = webCrypto.getRandomValues(new Uint8Array(16)) as Uint8Array;
  return Array.from(bytes, (byte: number) => byte.toString(16).padStart(2, "0")).join("");
};

export const clearLegacyMessengerStorage = () => {
  try {
    window.localStorage.removeItem(LEGACY_KEY_STORAGE);
  } catch {
    // Ignore storage access issues.
  }
};

export const initSodium = async () => {
  if (!sodiumPromise) {
    sodiumPromise = (async () => {
      const sodium = require("libsodium-wrappers");
      await sodium.ready;
      return sodium;
    })();
  }

  return sodiumPromise;
};

const decryptPrivateKey = async (record: StoredDeviceRecord) => {
  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(record.iv),
    },
    record.keyEncryptionKey,
    fromBase64(record.encryptedPrivateKey)
  );

  return new TextDecoder().decode(decrypted);
};

const wrapAndStoreDevice = async (input: { publicKey: string; privateKey: string; deviceId: string }) => {
  const webCrypto = window.crypto as any;
  const keyEncryptionKey = await webCrypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );

  const iv = webCrypto.getRandomValues(new Uint8Array(12));
  const encryptedPrivateKey = await webCrypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    keyEncryptionKey,
    new TextEncoder().encode(input.privateKey)
  );

  await writeRecord({
    version: 2,
    deviceId: input.deviceId,
    publicKey: input.publicKey,
    encryptedPrivateKey: toBase64(encryptedPrivateKey),
    iv: toBase64(iv),
    keyEncryptionKey,
  });
};

const createWrappedDeviceKeys = async () => {
  const sodium = await initSodium();
  const pair = sodium.crypto_box_keypair();
  const deviceId = createDeviceId();
  const publicKey = sodium.to_base64(pair.publicKey, sodium.base64_variants.ORIGINAL);
  const privateKey = sodium.to_base64(pair.privateKey, sodium.base64_variants.ORIGINAL);

  await wrapAndStoreDevice({ deviceId, publicKey, privateKey });

  return {
    deviceId,
    publicKey,
    privateKey,
  } satisfies DeviceKeys;
};

const migrateLegacyKeysIfPresent = async (): Promise<DeviceKeys | null> => {
  const legacy = window.localStorage.getItem(LEGACY_KEY_STORAGE);
  if (!legacy) {
    return null;
  }

  const parsed = JSON.parse(legacy) as Partial<DeviceKeys>;
  if (!parsed.publicKey || !parsed.privateKey) {
    window.localStorage.removeItem(LEGACY_KEY_STORAGE);
    return null;
  }

  const deviceId = parsed.deviceId || createDeviceId();
  await wrapAndStoreDevice({
    deviceId,
    publicKey: parsed.publicKey,
    privateKey: parsed.privateKey,
  });

  window.localStorage.removeItem(LEGACY_KEY_STORAGE);

  return {
    deviceId,
    publicKey: parsed.publicKey,
    privateKey: parsed.privateKey,
  };
};

export const getOrCreateDeviceKeys = async (): Promise<DeviceKeys> => {
  const record = await readRecord();
  if (!record) {
    const migrated = await migrateLegacyKeysIfPresent();
    if (migrated) {
      return migrated;
    }
    return createWrappedDeviceKeys();
  }

  const deviceId = await ensureDeviceId(record);
  return {
    deviceId,
    publicKey: record.publicKey,
    privateKey: await decryptPrivateKey(record),
  };
};

export const createConversationKey = () => (window.crypto as any).getRandomValues(new Uint8Array(32));

export const encryptConversationKeyForParticipant = async (conversationKey: Uint8Array, recipientPublicKey: string) => {
  const sodium = await initSodium();
  const sealed = sodium.crypto_box_seal(
    conversationKey,
    sodium.from_base64(recipientPublicKey, sodium.base64_variants.ORIGINAL)
  );
  return sodium.to_base64(sealed, sodium.base64_variants.ORIGINAL);
};

export const decryptConversationKey = async (encryptedKey: string, keys: DeviceKeys) => {
  const sodium = await initSodium();
  return sodium.crypto_box_seal_open(
    sodium.from_base64(encryptedKey, sodium.base64_variants.ORIGINAL),
    sodium.from_base64(keys.publicKey, sodium.base64_variants.ORIGINAL),
    sodium.from_base64(keys.privateKey, sodium.base64_variants.ORIGINAL)
  );
};

export const encryptMessage = async (plainText: string, conversationKey: Uint8Array) => {
  const sodium = await initSodium();
  const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
  const ciphertext = sodium.crypto_secretbox_easy(new TextEncoder().encode(plainText), nonce, conversationKey);

  return {
    ciphertext: sodium.to_base64(ciphertext, sodium.base64_variants.ORIGINAL),
    nonce: sodium.to_base64(nonce, sodium.base64_variants.ORIGINAL),
  };
};

export const decryptMessage = async (ciphertext: string, nonce: string, conversationKey: Uint8Array) => {
  const sodium = await initSodium();
  const plain = sodium.crypto_secretbox_open_easy(
    sodium.from_base64(ciphertext, sodium.base64_variants.ORIGINAL),
    sodium.from_base64(nonce, sodium.base64_variants.ORIGINAL),
    conversationKey
  );

  return new TextDecoder().decode(plain);
};
