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
    // Provide require() shim for protobufjs (uses require('bytebuffer') internally)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const win = window as any;
    if (!win.require) {
      win.require = (module: string) => {
        if (module === "long") return win.Long;
        if (module === "bytebuffer") return win.ByteBuffer;
        if (module === "protobufjs") return win.ProtoBuf;
        if (module === "mocha-bytebuffer") return win.ByteBuffer;
        throw new Error(`require('${module}') not available in browser`);
      };
    }
    // Load long.js first (provides window.Long)
    await loadScript("/long.js");
    // Load protobufjs (provides window.ProtoBuf, uses require('bytebuffer'))
    await loadScript("/protobuf.js");
    // Load libsignal-protocol (uses window.Long, ProtoBuf, ByteBuffer)
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

export function getFingerprintGenerator() {
  return libsignal.FingerprintGenerator;
}
