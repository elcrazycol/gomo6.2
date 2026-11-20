import { describe, it, expect, beforeEach } from "vitest";
import {
  E2E_ALG,
  E2E_MARKER,
  decryptE2EMessage,
  encryptE2EMessage,
  ensureE2EDevice,
  getE2EDevicePublicJwk,
  parseE2EEnvelope,
} from "./messengerCrypto";

describe("messengerCrypto (1:1 E2E envelope)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("mints a device identity once and reuses it", async () => {
    const first = await ensureE2EDevice();
    expect(first?.deviceId).toBeTruthy();
    expect(first?.publicJwk.kty).toBe("EC");

    const second = await ensureE2EDevice();
    expect(second?.deviceId).toBe(first?.deviceId);

    const loaded = await getE2EDevicePublicJwk();
    expect(loaded?.deviceId).toBe(first?.deviceId);
  });

  it("round-trips a message between two devices", async () => {
    // Device A (sender)
    const deviceA = await ensureE2EDevice();
    const publicA = deviceA!.publicJwk;
    const storedA = localStorage.getItem("gomo6:e2e:device:v1");

    // Device B (peer): mint an independent identity
    localStorage.clear();
    const deviceB = await ensureE2EDevice();
    const publicB = deviceB!.publicJwk;
    expect(deviceB!.deviceId).not.toBe(deviceA!.deviceId);
    const storedB = localStorage.getItem("gomo6:e2e:device:v1");

    // A encrypts for B (A's device active, peer = B's public key)
    localStorage.setItem("gomo6:e2e:device:v1", storedA!);
    const wire = await encryptE2EMessage("привет e2e", publicB, "conv-1", "user-a");
    expect(wire.startsWith(`${E2E_MARKER}${E2E_ALG}:`)).toBe(true);

    // B decrypts A's message (B's device active, peer = A's public key)
    localStorage.setItem("gomo6:e2e:device:v1", storedB!);
    const plain = await decryptE2EMessage(wire, publicA, "conv-1", "user-a");
    expect(plain).toBe("привет e2e");
  });

  it("binds the ciphertext to the conversation and sender (no replay)", async () => {
    const device = await ensureE2EDevice();
    const wire = await encryptE2EMessage("secret", device!.publicJwk, "conv-1", "user-a");

    // Same device pair, different conversation → must not decrypt
    expect(await decryptE2EMessage(wire, device!.publicJwk, "conv-2", "user-a")).toBeNull();
    // Same conversation, forged sender → must not decrypt
    expect(await decryptE2EMessage(wire, device!.publicJwk, "conv-1", "user-b")).toBeNull();
  });

  it("rejects foreign envelopes without decrypting", async () => {
    const device = await ensureE2EDevice();
    expect(await decryptE2EMessage("plain text", device!.publicJwk, "conv-1", "user-a")).toBeNull();
    expect(await decryptE2EMessage("e2enote1:abcdef", device!.publicJwk, "conv-1", "user-a")).toBeNull();
    expect(await decryptE2EMessage("e2e1:unknown:QUJD", device!.publicJwk, "conv-1", "user-a")).toBeNull();
    expect(parseE2EEnvelope("e2e1:p256-aesgcm:QUJD")).toEqual({ v: 1, alg: E2E_ALG });
    expect(parseE2EEnvelope("nope")).toBeNull();
  });
});
