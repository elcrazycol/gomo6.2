declare module "libsignal-protocol" {
  export class SignalProtocolAddress {
    constructor(name: string, deviceId: number);
    getName(): string;
    getDeviceId(): number;
    toString(): string;
  }
}

declare module "libsignal-protocol/dist/libsignal-protocol.js" {
  const value: unknown;
  export default value;
}
