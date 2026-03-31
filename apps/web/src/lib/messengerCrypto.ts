const STORE_KEY = "gomo6-messenger-sodium-state";

type LocalCryptoState = {
  version: 1;
  userId: string;
  publicKey: string;
  privateKey: string;
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

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

let sodiumPromise: Promise<SodiumModule> | null = null;

const ensureSodium = async () => {
  if (!sodiumPromise) {
    sodiumPromise = import("libsodium-wrappers").then(async (module) => {
      const sodium = (module.default ?? module) as unknown as SodiumModule;
      await sodium.ready;
      return sodium;
    });
  }

  return sodiumPromise;
};

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return window.btoa(binary);
};

const fromBase64 = (value: string) => {
  const binary = window.atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
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

export const ensureLocalMessengerState = async (userId: string) => {
  const current = readState();
  if (current?.userId === userId) {
    return current;
  }

  const sodium = await ensureSodium();
  const keyPair = sodium.crypto_box_keypair();
  const next: LocalCryptoState = {
    version: 1,
    userId,
    publicKey: toBase64(keyPair.publicKey),
    privateKey: toBase64(keyPair.privateKey),
  };
  writeState(next);
  return next;
};

export const encryptMessengerText = async ({
  plainText,
  recipientPublicKey,
  senderPrivateKey,
}: {
  plainText: string;
  recipientPublicKey: string;
  senderPrivateKey: string;
}) => {
  const sodium = await ensureSodium();
  const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
  const cipherText = sodium.crypto_box_easy(
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

export const decryptMessengerText = async ({
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
  const sodium = await ensureSodium();
  const decrypted = sodium.crypto_box_open_easy(
    fromBase64(cipherText),
    fromBase64(nonce),
    fromBase64(peerPublicKey),
    fromBase64(myPrivateKey)
  );

  return textDecoder.decode(decrypted);
};

export const createClientMessageId = () =>
  `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
