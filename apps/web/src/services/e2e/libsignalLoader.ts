// Wrapper for libsignal-protocol which uses window.libsignal (UMD)
// This module ensures the library is loaded and provides typed access

let loaded = false;

export async function loadLibsignal(): Promise<void> {
  if (loaded) return;
  // Import the library - it assigns to window.libsignal
  await import("libsignal-protocol/dist/libsignal-protocol.js");
  loaded = true;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const libsignal: any;

export function getKeyHelper() {
  return libsignal.KeyHelper;
}

export function getSessionBuilder(
  storage: unknown,
  remoteAddress: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return new libsignal.SessionBuilder(storage, remoteAddress);
}

export function getSessionCipher(
  storage: unknown,
  remoteAddress: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return new libsignal.SessionCipher(storage, remoteAddress);
}
