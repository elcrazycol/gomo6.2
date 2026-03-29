export const textEncoder = new TextEncoder();
export const textDecoder = new TextDecoder();

export const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

export const fromBase64 = (value: string) => new Uint8Array(Buffer.from(value, "base64"));

export const randomClientMessageId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
};
