import {
  getDeviceId,
  getIdentityKeyPair,
  saveIdentityKeyPair,
  saveSignedPreKey,
  getOneTimePreKeys,
  saveOneTimePreKeys,
  getRegistrationId,
  saveRegistrationId,
  type OneTimePreKey,
} from "./e2eKeyStorage";
import {
  generateIdentityKeyPair,
  generateSignedPreKey,
  generatePreKeys,
  generateRegistrationId,
  bufferToBase64,
  base64ToBuffer,
  loadAllKeyMaterial,
  getCurrentIdentityKeyPair,
  getLocalRegistrationId,
  setLocalRegistrationId,
  performKeyExchange,
  encryptMessage,
  decryptMessage,
  sessionStore,
} from "./e2eCrypto";
import * as e2eApi from "./e2eApi";
import { messengerApi } from "@/services/messengerApi";

// ─── Web Locks for concurrent tab safety ─────────────────────────────────────

async function withKeyLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if ("locks" in navigator) {
    return navigator.locks.request(`e2e-${name}`, async () => fn());
  }
  return fn();
}

// ─── Session creation mutex ──────────────────────────────────────────────────

const sessionMutexes = new Map<string, Promise<void>>();

function withSessionMutex<T>(recipientId: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionMutexes.get(recipientId) || Promise.resolve();
  const next = prev.then(fn, fn);
  sessionMutexes.set(recipientId, next.then(() => {}));
  next.then(() => {
    if (sessionMutexes.get(recipientId) === next) {
      sessionMutexes.delete(recipientId);
    }
  });
  return next;
}

// ─── State ───────────────────────────────────────────────────────────────────

let initialized = false;
let initPromise: Promise<void> | null = null;

// ─── Initialization ──────────────────────────────────────────────────────────

export async function initE2E(): Promise<void> {
  if (initialized) return;
  if (initPromise) return initPromise;

  initPromise = withKeyLock("key-init", async () => {
    const deviceId = getDeviceId();
    const existing = await getIdentityKeyPair(deviceId);
    if (!existing) {
      await generateAndRegisterKeys(deviceId);
    }

    // Load registration ID
    let regId = getRegistrationId();
    if (regId === null) {
      // Legacy device — generate and save
      await loadAllKeyMaterial(deviceId);
      regId = await generateRegistrationId();
      saveRegistrationId(regId);
      setLocalRegistrationId(regId);
    } else {
      setLocalRegistrationId(regId);
    }

    // Load all key material from IndexedDB into in-memory Signal stores
    await loadAllKeyMaterial(deviceId);
    initialized = true;
  });

  return initPromise;
}

async function generateAndRegisterKeys(deviceId: string): Promise<void> {
  const ik = await generateIdentityKeyPair();
  const spk = await generateSignedPreKey(ik, 1);
  const opks = await generatePreKeys(1, 100);
  const regId = await generateRegistrationId();

  await saveIdentityKeyPair({
    deviceId,
    publicKey: ik.pubKey,
    privateKey: ik.privKey,
  });

  await saveSignedPreKey({
    deviceId,
    keyId: spk.keyId,
    publicKey: spk.keyPair.pubKey,
    privateKey: spk.keyPair.privKey,
    signature: spk.signature,
  });

  const opkEntries: OneTimePreKey[] = opks.map((k) => ({
    id: `opk-${k.keyId}-${deviceId}`,
    keyId: k.keyId,
    publicKey: k.keyPair.pubKey,
    privateKey: k.keyPair.privKey,
  }));
  await saveOneTimePreKeys(opkEntries);

  saveRegistrationId(regId);
  setLocalRegistrationId(regId);

  await e2eApi.registerKeys({
    device_id: deviceId,
    public_identity_key: bufferToBase64(ik.pubKey),
    public_signed_pre_key: bufferToBase64(spk.keyPair.pubKey),
    signed_pre_key_signature: bufferToBase64(spk.signature),
    one_time_pre_keys: opkEntries.map((k) => ({
      id: k.id,
      public_key: bufferToBase64(k.publicKey),
    })),
  });
}

// ─── Check if device is ready ────────────────────────────────────────────────

export async function ensureDeviceReady(): Promise<boolean> {
  const deviceId = getDeviceId();
  const existing = await getIdentityKeyPair(deviceId);
  if (existing) {
    if (!initialized) {
      await loadAllKeyMaterial(deviceId);
      const regId = getRegistrationId();
      if (regId !== null) setLocalRegistrationId(regId);
      initialized = true;
    }
    return true;
  }
  await initE2E();
  return true;
}

// ─── Start E2E Chat ─────────────────────────────────────────────────────────

export async function startE2EChat(
  otherUserId: string
): Promise<{ conversationId: string; needsOtherUserKeys: boolean }> {
  await ensureDeviceReady();

  const result = await messengerApi.getOrCreateConversation(otherUserId, true);
  const conversationId = (result as { conversation_id: string }).conversation_id;

  let needsOtherUserKeys = false;
  try {
    const bundle = await e2eApi.fetchKeyBundle(otherUserId);
    if (!bundle.devices || bundle.devices.length === 0) {
      needsOtherUserKeys = true;
    }
  } catch {
    needsOtherUserKeys = true;
  }

  return { conversationId, needsOtherUserKeys };
}

// ─── Send E2E Message ───────────────────────────────────────────────────────

export async function sendE2EMessage(
  conversationId: string,
  recipientUserId: string,
  plaintext: string,
  senderDeviceId: string
): Promise<void> {
  await ensureDeviceReady();

  return withSessionMutex(recipientUserId, async () => {
    const bundle = await e2eApi.fetchKeyBundle(recipientUserId);
    if (!bundle.devices || bundle.devices.length === 0) {
      throw new Error("Recipient has no E2E keys");
    }

    const ourIdentityKey = getCurrentIdentityKeyPair();
    if (!ourIdentityKey) {
      throw new Error("Local identity key pair not loaded");
    }

    const ciphertexts: { device_id: string; ephemeral_key: string; ciphertext: string }[] = [];

    for (const device of bundle.devices) {
      const addressName = recipientUserId;
      const theirDeviceIdNum = parseInt(device.device_id, 10) || 1;

      // Check if session already exists for this specific device
      const addressStr = `${addressName}.${theirDeviceIdNum}`;
      const existingSessions = sessionStore.getSync(addressStr);
      const needsKeyExchange = !existingSessions || Object.keys(existingSessions).length === 0;

      if (needsKeyExchange) {
        const theirIdentityKey = base64ToBuffer(device.public_identity_key);
        const theirSignedPreKey = base64ToBuffer(device.public_signed_pre_key);
        const theirOneTimePreKey = device.one_time_pre_key
          ? base64ToBuffer(device.one_time_pre_key.public_key)
          : null;

        try {
          await performKeyExchange(
            theirIdentityKey,
            theirSignedPreKey,
            theirOneTimePreKey,
            getLocalRegistrationId() || 0,
            theirDeviceIdNum,
            ourIdentityKey,
            addressName
          );

          if (device.one_time_pre_key) {
            await e2eApi.consumePreKey(device.one_time_pre_key.id);
          }
        } catch (err) {
          const error = err as Error;
          if (error.message?.includes("Identity key changed")) {
            throw new Error(
              `Ключи безопасности @${recipientUserId} изменились. ` +
              `Возможно, он сменил устройство или канал скомпрометирован. ` +
              `Сообщение НЕ отправлено.`
            );
          }
          throw err;
        }
      }

      const { ciphertext } = await encryptMessage(plaintext, addressName, theirDeviceIdNum);

      ciphertexts.push({
        device_id: device.device_id,
        ephemeral_key: "",
        ciphertext,
      });
    }

    await messengerApi.sendMessage(conversationId, "", crypto.randomUUID(), undefined, undefined, {
      is_encrypted: true,
      ciphertexts,
      sender_device_id: senderDeviceId,
    });

    rotatePreKeys().catch(() => {});
  });
}

// ─── Receive E2E Message ────────────────────────────────────────────────────

export async function receiveE2EMessage(
  ciphertexts: { device_id: string; ciphertext: string }[],
  myDeviceId: string,
  senderUserId: string,
  senderDeviceId?: string
): Promise<string | null> {
  await ensureDeviceReady();

  const myEntry = ciphertexts.find((e) => e.device_id === myDeviceId);
  if (!myEntry) {
    return null;
  }

  try {
    const senderDeviceIdNum = senderDeviceId ? (parseInt(senderDeviceId, 10) || 1) : 1;

    const plaintext = await decryptMessage(
      myEntry.ciphertext,
      senderUserId,
      senderDeviceIdNum
    );

    return plaintext;
  } catch (err) {
    console.error("[E2E] Decryption failed:", err);
    return null;
  }
}

// ─── OPK Replenishment ──────────────────────────────────────────────────────

export async function rotatePreKeys(): Promise<void> {
  await withKeyLock("opk-replenish", async () => {
    const keys = await getOneTimePreKeys();
    if (keys.length >= 10) return;

    const startId = keys.length > 0 ? Math.max(...keys.map((k) => k.keyId)) + 1 : 1;
    const newKeys = await generatePreKeys(startId, 90);

    const deviceId = getDeviceId();
    const entries: OneTimePreKey[] = newKeys.map((k) => ({
      id: `opk-${k.keyId}-${deviceId}`,
      keyId: k.keyId,
      publicKey: k.keyPair.pubKey,
      privateKey: k.keyPair.privKey,
    }));

    await saveOneTimePreKeys(entries);

    await e2eApi.uploadPreKeys(
      entries.map((k) => ({
        id: k.id,
        public_key: bufferToBase64(k.publicKey),
      }))
    );
  });
}

// ─── Get current device ID ──────────────────────────────────────────────────

export { getDeviceId };
