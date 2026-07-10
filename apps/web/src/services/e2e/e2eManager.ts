import {
  getDeviceId,
  getIdentityKeyPair,
  saveIdentityKeyPair,
  getSignedPreKey,
  saveSignedPreKey,
  getOneTimePreKeys,
  saveOneTimePreKeys,
  removeOneTimePreKey,
  type IdentityKeyPair,
  type SignedPreKey,
  type OneTimePreKey,
} from "./e2eKeyStorage";
import {
  generateIdentityKeyPair,
  generateSignedPreKey,
  generatePreKeys,
  bufferToBase64,
  base64ToBuffer,
  type GeneratedKeyPair,
} from "./e2eCrypto";
import * as e2eApi from "./e2eApi";
import { messengerApi } from "@/services/messengerApi";

// ─── Web Locks for concurrent tab safety ─────────────────────────────────────

async function withKeyLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if ("locks" in navigator) {
    return navigator.locks.request(`e2e-${name}`, async () => fn());
  }
  // Fallback: no lock API (very old browsers)
  return fn();
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
      // First time: generate keys and register
      await generateAndRegisterKeys(deviceId);
    }
    initialized = true;
  });

  return initPromise;
}

async function generateAndRegisterKeys(deviceId: string): Promise<void> {
  // Generate identity key pair
  const ik = await generateIdentityKeyPair();

  // Generate signed pre-key
  const spk = await generateSignedPreKey(ik, 1);

  // Generate 100 one-time pre-keys
  const opks = await generatePreKeys(1, 100);

  // Save to IndexedDB
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

  // Register on server
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
    initialized = true;
    return true;
  }
  await initE2E();
  return true;
}

// ─── Start E2E Chat ─────────────────────────────────────────────────────────

export async function startE2EChat(
  otherUserId: string
): Promise<{ conversationId: string }> {
  await ensureDeviceReady();

  // Fetch other user's key bundle
  const bundle = await e2eApi.fetchKeyBundle(otherUserId);
  if (!bundle.devices || bundle.devices.length === 0) {
    throw new Error(
      "User has no E2E keys registered. They need to start an E2E chat first."
    );
  }

  // Create E2E conversation on server
  const result = await messengerApi.getOrCreateConversation(otherUserId, true);
  const conversationId = (result as { conversation_id: string }).conversation_id;

  return { conversationId };
}

// ─── Send E2E Message ───────────────────────────────────────────────────────

export async function sendE2EMessage(
  conversationId: string,
  recipientUserId: string,
  plaintext: string,
  senderDeviceId: string
): Promise<void> {
  // Fetch recipient's devices
  const bundle = await e2eApi.fetchKeyBundle(recipientUserId);
  if (!bundle.devices || bundle.devices.length === 0) {
    throw new Error("Recipient has no E2E keys");
  }

  // For MVP: encrypt for the recipient's first device
  // Full implementation would encrypt for all devices + sender's other devices
  const targetDevice = bundle.devices[0];

  // Consume OPK if present
  if (targetDevice.one_time_pre_key) {
    await e2eApi.consumePreKey(targetDevice.one_time_pre_key.id);
  }

  // Perform key exchange and encrypt
  // This is a simplified version - real implementation needs proper session management
  const ciphertexts = [
    {
      device_id: targetDevice.device_id,
      ephemeral_key: "", // Would be set by X3DH
      ciphertext: btoa(plaintext), // Simplified: base64 for MVP, real encryption in Phase 3
    },
  ];

  // Send via messenger API
  await messengerApi.sendMessage(conversationId, "", crypto.randomUUID(), undefined, undefined, {
    is_encrypted: true,
    ciphertexts,
    sender_device_id: senderDeviceId,
  });
}

// ─── Receive E2E Message ────────────────────────────────────────────────────

export async function receiveE2EMessage(
  ciphertexts: { device_id: string; ciphertext: string }[],
  myDeviceId: string
): Promise<string | null> {
  // Find my device's ciphertext
  const myEntry = ciphertexts.find((e) => e.device_id === myDeviceId);
  if (!myEntry) {
    return null; // Not for this device
  }

  // Decrypt (simplified for MVP - real implementation uses Double Ratchet)
  try {
    return atob(myEntry.ciphertext);
  } catch {
    return null;
  }
}

// ─── OPK Replenishment ──────────────────────────────────────────────────────

export async function rotatePreKeys(): Promise<void> {
  await withKeyLock("opk-replenish", async () => {
    const keys = await getOneTimePreKeys();
    if (keys.length >= 10) return; // Enough keys

    // Generate 90 more
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

    // Upload to server
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
