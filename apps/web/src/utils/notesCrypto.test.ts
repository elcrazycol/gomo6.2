import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  NOTES_MARKER_PREFIX,
  decryptNote,
  decryptNotesMeta,
  encryptNote,
  encryptNotesMeta,
  hasNotesKey,
  importNotesKey,
} from "./notesCrypto";

type NotesCryptoModule = typeof import("./notesCrypto");

describe("notesCrypto (E2E notes encryption)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("encrypts and decrypts a note round trip without leaking plaintext", async () => {
    const convId = "10000000-0000-0000-0000-000000000001";
    const payload = await encryptNote("Секретная мысль 🤫", convId);

    expect(payload.startsWith(NOTES_MARKER_PREFIX)).toBe(true);
    // The plaintext must never appear in the wire payload.
    expect(payload.includes("Секретная")).toBe(false);

    expect(await decryptNote(payload, convId)).toBe("Секретная мысль 🤫");
  });

  it("binds ciphertext to the conversation id (AAD)", async () => {
    const payload = await encryptNote("hello", "conv-a");
    expect(await decryptNote(payload, "conv-b")).toBeNull();
    expect(await decryptNote(payload, "conv-a")).toBe("hello");
  });

  it("fails to decrypt with a different key", async () => {
    const payload = await encryptNote("secret", "conv-a");
    // Swap in a different (valid) key.
    expect(await importNotesKey("ab".repeat(32))).toBe(true);
    expect(await decryptNote(payload, "conv-a")).toBeNull();
  });

  it("returns null for non-notes payloads", async () => {
    expect(await decryptNote("plain text", "conv-a")).toBeNull();
    expect(await decryptNote("", "conv-a")).toBeNull();
  });

  it("never creates a key when only reading (restore-first flow)", async () => {
    vi.resetModules();
    const fresh = (await import("./notesCrypto")) as NotesCryptoModule;
    expect(fresh.hasNotesKey()).toBe(false);
    expect(await fresh.decryptNote("e2enote1:some-ciphertext", "conv-a")).toBeNull();
    expect(await fresh.decryptNotesMeta("e2enote1:some-meta", "conv-a")).toBeNull();
    // A fresh device that only wants to restore a backup must NOT silently
    // mint its own key — otherwise the restore banner never shows and an
    // orphan key gets in the way of cross-device recovery.
    expect(fresh.hasNotesKey()).toBe(false);
  });

  it("creates the key only on the first write", async () => {
    vi.resetModules();
    const fresh = (await import("./notesCrypto")) as NotesCryptoModule;
    expect(fresh.hasNotesKey()).toBe(false);
    const payload = await fresh.encryptNote("первая запись", "conv-a");
    expect(payload.startsWith(NOTES_MARKER_PREFIX)).toBe(true);
    expect(fresh.hasNotesKey()).toBe(true);
  });

  it("rejects corrupted payloads", async () => {
    const payload = await encryptNote("secret", "conv-a");
    const corrupted = `${payload.slice(0, -4)}AAAA`;
    expect(await decryptNote(corrupted, "conv-a")).toBeNull();
  });

  it("encrypts and decrypts notes metadata (pin/folder/tags) without leaking plaintext", async () => {
    const convId = "conv-a";
    const wire = await encryptNotesMeta({ pinned: true, folder: "Идеи", tags: ["важно", "работа"] }, convId);

    expect(wire.startsWith(NOTES_MARKER_PREFIX)).toBe(true);
    // Folder/tag plaintext must never appear in the wire payload.
    expect(wire.includes("Идеи")).toBe(false);

    expect(await decryptNotesMeta(wire, convId)).toEqual({
      pinned: true,
      folder: "Идеи",
      tags: ["важно", "работа"],
    });
  });

  it("returns null for absent or corrupt notes metadata", async () => {
    expect(await decryptNotesMeta(null, "conv-a")).toBeNull();
    expect(await decryptNotesMeta(undefined, "conv-a")).toBeNull();
    expect(await decryptNotesMeta("plain text", "conv-a")).toBeNull();

    const wire = await encryptNotesMeta({ pinned: true }, "conv-a");
    const corrupted = `${wire.slice(0, -4)}AAAA`;
    expect(await decryptNotesMeta(corrupted, "conv-a")).toBeNull();
  });

  it("binds notes metadata to the conversation id (AAD)", async () => {
    const wire = await encryptNotesMeta({ folder: "секрет" }, "conv-a");
    expect(await decryptNotesMeta(wire, "conv-b")).toBeNull();
    expect(await decryptNotesMeta(wire, "conv-a")).toEqual({ folder: "секрет" });
  });

  it("restores access after storage is cleared (backup key flow)", async () => {
    // Use a fresh module instance (like a new page load) so the in-memory key
    // cache does not survive the simulated storage wipe.
    vi.resetModules();
    const first = (await import("./notesCrypto")) as NotesCryptoModule;
    const convId = "conv-a";
    const payload = await first.encryptNote("backup me", convId);
    const exported = await first.exportNotesKey();
    expect(exported).toMatch(/^[0-9a-f]{64}$/);

    // Simulate a new device: storage wiped, key gone, notes unreadable.
    localStorage.clear();
    vi.resetModules();
    const fresh = (await import("./notesCrypto")) as NotesCryptoModule;
    expect(fresh.hasNotesKey()).toBe(false);
    expect(await fresh.decryptNote(payload, convId)).toBeNull();

    // Invalid input must not be accepted.
    expect(await fresh.importNotesKey("not a hex key")).toBe(false);
    expect(await fresh.importNotesKey("abcd")).toBe(false);

    // Restoring the backup key makes the ciphertext readable again.
    expect(await fresh.importNotesKey(exported!)).toBe(true);
    expect(fresh.hasNotesKey()).toBe(true);
    expect(await fresh.decryptNote(payload, convId)).toBe("backup me");
  });
});
