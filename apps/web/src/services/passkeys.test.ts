import { describe, it, expect } from "vitest";
import {
  bufferToBase64,
  base64ToBuffer,
  supportsWebAuthn,
  prepareRegistrationOptions,
  prepareLoginOptions,
  serializeRegistration,
  serializeAuthentication,
} from "./passkeys";

describe("bufferToBase64 / base64ToBuffer", () => {
  it("round-trips an empty buffer", () => {
    const original = new ArrayBuffer(0);
    const encoded = bufferToBase64(original);
    const decoded = base64ToBuffer(encoded);
    expect(decoded.byteLength).toBe(0);
  });

  it("round-trips a single byte", () => {
    const original = new Uint8Array([42]).buffer;
    const encoded = bufferToBase64(original);
    const decoded = base64ToBuffer(encoded);
    const view = new Uint8Array(decoded);
    expect(view.length).toBe(1);
    expect(view[0]).toBe(42);
  });

  it("round-trips multiple bytes", () => {
    const bytes = [0, 255, 128, 64, 32, 16, 8, 4, 2, 1];
    const original = new Uint8Array(bytes).buffer;
    const encoded = bufferToBase64(original);
    const decoded = base64ToBuffer(encoded);
    const view = new Uint8Array(decoded);
    expect(view.length).toBe(bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      expect(view[i]).toBe(bytes[i]);
    }
  });

  it("produces base64url without padding", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const encoded = bufferToBase64(bytes.buffer);
    // base64url → no +, no /, no =
    expect(encoded).not.toContain("+");
    expect(encoded).not.toContain("/");
    expect(encoded).not.toContain("=");
  });

  it("handles 16 random bytes (typical challenge size)", () => {
    const bytes = new Uint8Array([142, 45, 201, 78, 3, 167, 92, 11, 200, 64, 241, 200, 54, 99, 216, 11]);
    const encoded = bufferToBase64(bytes.buffer);
    const decoded = base64ToBuffer(encoded);
    const view = new Uint8Array(decoded);
    expect(view).toEqual(bytes);
  });
});

describe("supportsWebAuthn", () => {
  it("returns boolean", () => {
    const result = supportsWebAuthn();
    expect(typeof result).toBe("boolean");
  });
});

describe("prepareRegistrationOptions", () => {
  it("converts challenge from base64url to ArrayBuffer", () => {
    const challenge = new Uint8Array([1, 2, 3, 4]);
    const challengeB64 = bufferToBase64(challenge.buffer);
    const options = {
      challenge: challengeB64,
      rp: { name: "test", id: "localhost" },
      user: {
        id: bufferToBase64(new Uint8Array([5, 6, 7, 8]).buffer),
        name: "testuser",
        displayName: "Test User",
      },
    };

    const result = prepareRegistrationOptions(options);
    const resultChallenge = new Uint8Array(
      result.challenge as unknown as ArrayBuffer
    );
    expect(resultChallenge).toEqual(challenge);
  });

  it("converts user.id from base64url to ArrayBuffer", () => {
    const userId = new Uint8Array([10, 20, 30]);
    const userIdB64 = bufferToBase64(userId.buffer);
    const options = {
      challenge: bufferToBase64(new Uint8Array(16).buffer),
      rp: { name: "test", id: "localhost" },
      user: {
        id: userIdB64,
        name: "testuser",
        displayName: "Test User",
      },
    };

    const result = prepareRegistrationOptions(options);
    const resultUserId = new Uint8Array(
      (result.user as { id: ArrayBuffer }).id
    );
    expect(resultUserId).toEqual(userId);
  });

  it("handles options without user field gracefully", () => {
    const challenge = bufferToBase64(new Uint8Array(16).buffer);
    const options = {
      challenge,
      rp: { name: "test", id: "localhost" },
    };

    const result = prepareRegistrationOptions(options);
    expect(result.challenge).toBeDefined();
    expect(result.user).toBeUndefined();
  });
});

describe("prepareLoginOptions", () => {
  it("converts challenge and allowCredentials", () => {
    const challenge = new Uint8Array([9, 8, 7, 6]);
    const challengeB64 = bufferToBase64(challenge.buffer);
    const credId = new Uint8Array([1, 1, 1]);
    const credIdB64 = bufferToBase64(credId.buffer);

    const options = {
      challenge: challengeB64,
      rpId: "localhost",
      allowCredentials: [{ id: credIdB64, type: "public-key" }],
    };

    const result = prepareLoginOptions(options);
    const resultChallenge = new Uint8Array(
      result.challenge as unknown as ArrayBuffer
    );
    expect(resultChallenge).toEqual(challenge);

    const creds = result.allowCredentials as Array<{ id: ArrayBuffer }>;
    expect(creds).toBeDefined();
    expect(creds.length).toBe(1);
    expect(new Uint8Array(creds[0].id)).toEqual(credId);
  });

  it("handles options without allowCredentials (discoverable flow)", () => {
    const challenge = bufferToBase64(new Uint8Array(16).buffer);
    const options = {
      challenge,
      rpId: "localhost",
    };

    const result = prepareLoginOptions(options);
    expect(result.challenge).toBeDefined();
    expect(result.allowCredentials).toBeUndefined();
  });
});

describe("serializeRegistration", () => {
  it("serializes a mock registration credential", () => {
    const attestationObject = new Uint8Array([0xa0]);
    const clientDataJSON = new Uint8Array([0x7b, 0x7d]);

    const mockCredential = {
      id: "cred-123",
      rawId: new Uint8Array([1, 2, 3]).buffer,
      type: "public-key",
      response: {
        attestationObject: attestationObject.buffer,
        clientDataJSON: clientDataJSON.buffer,
      },
    } as unknown as PublicKeyCredential;

    const result = serializeRegistration(mockCredential);

    expect(result.id).toBe("cred-123");
    expect(result.type).toBe("public-key");
    expect(typeof result.rawId).toBe("string");
    expect(result.rawId).toBe(bufferToBase64(new Uint8Array([1, 2, 3]).buffer));

    const response = result.response as {
      attestationObject: string;
      clientDataJSON: string;
    };
    expect(response.attestationObject).toBe(
      bufferToBase64(attestationObject.buffer)
    );
    expect(response.clientDataJSON).toBe(
      bufferToBase64(clientDataJSON.buffer)
    );
  });

  it("handles null rawId", () => {
    const mockCredential = {
      id: "",
      rawId: null,
      type: "public-key",
      response: {
        attestationObject: new ArrayBuffer(0),
        clientDataJSON: new ArrayBuffer(0),
      },
    } as unknown as PublicKeyCredential;

    const result = serializeRegistration(mockCredential);
    expect(result.rawId).toBe("");
  });
});

describe("serializeAuthentication", () => {
  it("serializes a mock authentication credential", () => {
    const authenticatorData = new Uint8Array([0xa1, 0xa2]);
    const clientDataJSON = new Uint8Array([0x7b, 0x7d]);
    const signature = new Uint8Array([0xb1, 0xb2, 0xb3, 0xb4]);

    const mockCredential = {
      id: "cred-456",
      rawId: new Uint8Array([4, 5, 6]).buffer,
      type: "public-key",
      response: {
        authenticatorData: authenticatorData.buffer,
        clientDataJSON: clientDataJSON.buffer,
        signature: signature.buffer,
        userHandle: null,
      },
    } as unknown as PublicKeyCredential;

    const result = serializeAuthentication(mockCredential);

    expect(result.id).toBe("cred-456");
    expect(result.type).toBe("public-key");

    const response = result.response as Record<string, unknown>;
    expect(response.authenticatorData).toBe(
      bufferToBase64(authenticatorData.buffer)
    );
    expect(response.clientDataJSON).toBe(
      bufferToBase64(clientDataJSON.buffer)
    );
    expect(response.signature).toBe(bufferToBase64(signature.buffer));
    // userHandle should be omitted when null (go-webauthn expects missing key)
    expect("userHandle" in response).toBe(false);
  });

  it("includes userHandle when present", () => {
    const userHandle = new Uint8Array([16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16]);

    const mockCredential = {
      id: "cred-789",
      rawId: new ArrayBuffer(32),
      type: "public-key",
      response: {
        authenticatorData: new ArrayBuffer(0),
        clientDataJSON: new ArrayBuffer(0),
        signature: new ArrayBuffer(0),
        userHandle: userHandle.buffer,
      },
    } as unknown as PublicKeyCredential;

    const result = serializeAuthentication(mockCredential);
    const response = result.response as Record<string, unknown>;
    expect(response.userHandle).toBe(bufferToBase64(userHandle.buffer));
  });
});
