"use client";

const KEY_STORAGE = "gomo6_messenger_device_v1";
let sodiumPromise: Promise<any> | null = null;

export type DeviceKeys = {
  publicKey: string;
  privateKey: string;
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

export const getOrCreateDeviceKeys = async (): Promise<DeviceKeys> => {
  const box = await initSodium();
  const existing = window.localStorage.getItem(KEY_STORAGE);
  if (existing) {
    return JSON.parse(existing) as DeviceKeys;
  }

  const pair = box.crypto_box_keypair();
  const keys = {
    publicKey: box.to_base64(pair.publicKey, box.base64_variants.ORIGINAL),
    privateKey: box.to_base64(pair.privateKey, box.base64_variants.ORIGINAL),
  };

  window.localStorage.setItem(KEY_STORAGE, JSON.stringify(keys));
  return keys;
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
