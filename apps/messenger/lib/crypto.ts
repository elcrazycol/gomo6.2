"use client";

const DB_NAME = "gomo6-messenger-secure-store";
const DB_VERSION = 1;
const STORE_NAME = "device";
const DEVICE_RECORD_KEY = "primary";
const LEGACY_KEY_STORAGE = "gomo6_messenger_device_v1";

let sodiumPromise: Promise<any> | null = null;
let openDbPromise: Promise<IDBDatabase> | null = null;

export type DeviceKeys = {
  publicKey: string;
  privateKey: string;
};

type StoredDeviceRecord = {
  version: 1;
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

export const clearLegacyMessengerStorage = () => {
  try {
    window.localStorage.removeItem(LEGACY_KEY_STORAGE);
  } catch {
    // Ignore storage access issues.
  }
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
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64(record.iv),
    },
    record.keyEncryptionKey,
    fromBase64(record.encryptedPrivateKey)
  );

  return new TextDecoder().decode(decrypted);
};

const createWrappedDeviceKeys = async () => {
  const box = await initSodium();
  const pair = box.crypto_box_keypair();
  const keyEncryptionKey = await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );

  const publicKey = box.to_base64(pair.publicKey, box.base64_variants.ORIGINAL);
  const privateKey = box.to_base64(pair.privateKey, box.base64_variants.ORIGINAL);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedPrivateKey = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    keyEncryptionKey,
    new TextEncoder().encode(privateKey)
  );

  const record: StoredDeviceRecord = {
    version: 1,
    publicKey,
    encryptedPrivateKey: toBase64(encryptedPrivateKey),
    iv: toBase64(iv),
    keyEncryptionKey,
  };

  await writeRecord(record);

  return {
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

  const keyEncryptionKey = await crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedPrivateKey = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    keyEncryptionKey,
    new TextEncoder().encode(parsed.privateKey)
  );

  await writeRecord({
    version: 1,
    publicKey: parsed.publicKey,
    encryptedPrivateKey: toBase64(encryptedPrivateKey),
    iv: toBase64(iv),
    keyEncryptionKey,
  });

  window.localStorage.removeItem(LEGACY_KEY_STORAGE);

  return {
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

  return {
    publicKey: record.publicKey,
    privateKey: await decryptPrivateKey(record),
  };
};

export const encryptConversationKeyForParticipant = async (conversationKey: Uint8Array, recipientPublicKey: string) => {
  const box = await initSodium();
  const sealed = box.crypto_box_seal(
    conversationKey,
    box.from_base64(recipientPublicKey, box.base64_variants.ORIGINAL)
  );
  return box.to_base64(sealed, box.base64_variants.ORIGINAL);
};

export const decryptConversationKey = async (encryptedKey: string, keys: DeviceKeys) => {
  const box = await initSodium();
  const opened = box.crypto_box_seal_open(
    box.from_base64(encryptedKey, box.base64_variants.ORIGINAL),
    box.from_base64(keys.publicKey, box.base64_variants.ORIGINAL),
    box.from_base64(keys.privateKey, box.base64_variants.ORIGINAL)
  );
  return opened;
};

export const createConversationKey = async () => {
  const box = await initSodium();
  return box.randombytes_buf(box.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
};

export const encryptMessage = async (plainText: string, conversationKey: Uint8Array) => {
  const box = await initSodium();
  const nonce = box.randombytes_buf(box.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
  const cipher = box.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plainText,
    undefined,
    undefined,
    nonce,
    conversationKey
  );

  return {
    ciphertext: box.to_base64(cipher, box.base64_variants.ORIGINAL),
    nonce: box.to_base64(nonce, box.base64_variants.ORIGINAL),
  };
};

export const decryptMessage = async (ciphertext: string, nonce: string, conversationKey: Uint8Array) => {
  const box = await initSodium();
  const plain = box.crypto_aead_xchacha20poly1305_ietf_decrypt(
    undefined,
    box.from_base64(ciphertext, box.base64_variants.ORIGINAL),
    undefined,
    box.from_base64(nonce, box.base64_variants.ORIGINAL),
    conversationKey
  );

  return box.to_string(plain);
};
