let loaded = false;
let loadPromise: Promise<void> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const libsignal: any;

export async function loadLibsignal(): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const scriptId = "libsignal-protocol-script";
    if (document.getElementById(scriptId)) {
      loaded = true;
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.id = scriptId;
    script.src = "/libsignal-protocol.js";
    script.onload = () => { loaded = true; resolve(); };
    script.onerror = reject;
    document.head.appendChild(script);
  });

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
