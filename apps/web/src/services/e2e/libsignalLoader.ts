let loaded = false;
let loadPromise: Promise<void> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const libsignal: any;

function loadScript(src: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const scriptId = `script-${src}`;
    if (document.getElementById(scriptId)) { resolve(); return; }
    const script = document.createElement("script");
    script.id = scriptId;
    script.src = src;
    script.onload = () => resolve();
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

export async function loadLibsignal(): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    // Load long.js first (provides window.Long for libsignal-protocol)
    await loadScript("/long.js");
    // Load libsignal-protocol (uses window.Long internally)
    await loadScript("/libsignal-protocol.js");
    loaded = true;
  })();

  return loadPromise;
}

export function getSignalProtocolAddress(
  name: string,
  deviceId: number
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return new libsignal.SignalProtocolAddress(name, deviceId);
}

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
