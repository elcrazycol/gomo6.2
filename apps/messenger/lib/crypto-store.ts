"use client";

import { fromBase64, textDecoder, textEncoder, toBase64 } from "@/lib/encoding";

const STORE_KEY = "gomo6-messenger-sodium-state";

type LocalCryptoState = {
  version: 1;
  userId: string;
  publicKey: string;
  privateKey: string;
};

const readState = (): LocalCryptoState | null => {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.localStorage.getItem(STORE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as LocalCryptoState;
    if (
      parsed?.version !== 1 ||
      typeof parsed.userId !== "string" ||
      typeof parsed.publicKey !== "string" ||
      typeof parsed.privateKey !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

const writeState = (state: LocalCryptoState) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
};

type SodiumModule = {
  ready: Promise<unknown>;
  crypto_box_NONCEBYTES: number;
  crypto_box_keypair: () => { publicKey: Uint8Array; privateKey: Uint8Array };
  crypto_box_easy: (
    message: Uint8Array,
    nonce: Uint8Array,
    publicKey: Uint8Array,
    privateKey: Uint8Array
  ) => Uint8Array;
  crypto_box_open_easy: (
    cipherText: Uint8Array,
    nonce: Uint8Array,
    publicKey: Uint8Array,
    privateKey: Uint8Array
  ) => Uint8Array;
  randombytes_buf: (length: number) => Uint8Array;
};

let sodiumPromise: Promise<SodiumModule> | null = null;

const ensureSodium = async () => {
  if (!sodiumPromise) {
    sodiumPromise = import("libsodium-wrappers").then(async (module) => {
      const sodium = (module.default ?? module) as unknown as SodiumModule;
      await sodium.ready;
      return sodium;
    });
  }

  return await sodiumPromise;
};

export const ensureLocalCryptoState = async (userId: string) => {
  const current = readState();
  if (current?.userId === userId) {
    return current;
  }

  const libsodium = await ensureSodium();
  const keyPair = libsodium.crypto_box_keypair();
  const next: LocalCryptoState = {
    version: 1,
    userId,
    publicKey: toBase64(keyPair.publicKey),
    privateKey: toBase64(keyPair.privateKey),
  };
  writeState(next);
  return next;
};

export const buildBootstrapPayload = (state: LocalCryptoState) => ({
  publicKey: state.publicKey,
});

export const decryptChatMessage = async ({
  cipherText,
  nonce,
  peerPublicKey,
  myPrivateKey,
}: {
  cipherText: string;
  nonce: string;
  peerPublicKey: string;
  myPrivateKey: string;
}) => {
  const libsodium = await ensureSodium();
  const decrypted = libsodium.crypto_box_open_easy(
    fromBase64(cipherText),
    fromBase64(nonce),
    fromBase64(peerPublicKey),
    fromBase64(myPrivateKey)
  );
  return textDecoder.decode(decrypted);
};

export const encryptChatMessage = async ({
  plainText,
  recipientPublicKey,
  senderPrivateKey,
}: {
  plainText: string;
  recipientPublicKey: string;
  senderPrivateKey: string;
}) => {
  const libsodium = await ensureSodium();
  const nonce = libsodium.randombytes_buf(libsodium.crypto_box_NONCEBYTES);
  const cipherText = libsodium.crypto_box_easy(
    textEncoder.encode(plainText),
    nonce,
    fromBase64(recipientPublicKey),
    fromBase64(senderPrivateKey)
  );

  return {
    nonce: toBase64(nonce),
    cipherText: toBase64(cipherText),
  };
};

export const resetLocalCryptoState = async () => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(STORE_KEY);
};
