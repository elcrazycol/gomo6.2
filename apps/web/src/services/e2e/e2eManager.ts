import {
  getDeviceId,
  getIdentityKeyPair,
  saveIdentityKeyPair,
  saveSignedPreKey,
  getOneTimePreKeys,
  saveOneTimePreKeys,
  type OneTimePreKey,
} from "./e2eKeyStorage";
import {
  generateIdentityKeyPair,
  generateSignedPreKey,
  generatePreKeys,
  bufferToBase64,
  loadAllKeyMaterial,
  getCurrentIdentityKeyPair,
  performKeyExchange,
  encryptMessage,
  decryptMessage,
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
// Prevents race conditions when sending rapid messages to same recipient

const sessionMutexes = new Map<string, Promise<void>>();

function withSessionMutex<T>(recipientId: string, fn: () => Promise<T>): Promise<T> {
  const prev = sessionMutexes.get(recipientId) || Promise.resolve();
  const next = prev.then(fn, fn);
  sessionMutexes.set(recipientId, next.then(() => { /* cleanup on next tick */ }));
  // Don't keep stale entries
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
    // Fetch recipient's key bundle
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

      // Decode their public keys from base64
      const theirIdentityKey = base64ToBuffer(device.public_identity_key);
      const theirSignedPreKey = base64ToBuffer(device.public_signed_pre_key);
      const theirOneTimePreKey = device.one_time_pre_key
        ? base64ToBuffer(device.one_time_pre_key.public_key)
        : null;

      // Perform X3DH key exchange if no session exists yet
      const theirDeviceIdNum = parseInt(device.device_id, 10) || 1;
      // Check if session exists by trying to get it
      // If performKeyExchange fails, it means we already have a session
      try {
        await performKeyExchange(
          theirIdentityKey,
          theirSignedPreKey,
          theirOneTimePreKey,
          0, // registrationId — not critical for processing
          theirDeviceIdNum,
          ourIdentityKey,
          addressName
        );

        // Consume OPK on server (before sending, so server stops offering it)
        if (device.one_time_pre_key) {
          await e2eApi.consumePreKey(device.one_time_pre_key.id);
        }
      } catch {
        // Session may already exist — proceed with encryption
      }

      // Encrypt with real Signal Protocol
      const { ciphertext } = await encryptMessage(plaintext, addressName, theirDeviceIdNum);

      ciphertexts.push({
        device_id: device.device_id,
        ephemeral_key: "",
        ciphertext,
      });
    }

    // Send via messenger API
    await messengerApi.sendMessage(conversationId, "", crypto.randomUUID(), undefined, undefined, {
      is_encrypted: true,
      ciphertexts,
      sender_device_id: senderDeviceId,
    });

    // Replenish OPKs if running low
    rotatePreKeys().catch(() => { /* fire and forget */ });
  });
}

// ─── Receive E2E Message ────────────────────────────────────────────────────

export async function receiveE2EMessage(
  ciphertexts: { device_id: string; ciphertext: string }[],
  myDeviceId: string,
  senderUserId: string
): Promise<string | null> {
  await ensureDeviceReady();

  // Find my device's ciphertext
  const myEntry = ciphertexts.find((e) => e.device_id === myDeviceId);
  if (!myEntry) {
    return null;
  }

  try {
    // senderUserId is used as the address name for Signal protocol
    // The sender's device ID is extracted from the ciphertext entry
    // For now we use device ID 1 as default (sender's primary device)
    const senderDeviceId = 1;

    const plaintext = await decryptMessage(
      myEntry.ciphertext,
      senderUserId,
      senderDeviceId
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
