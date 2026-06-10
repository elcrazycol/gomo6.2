// WebAuthn/Passkey utilities for the frontend.
// Converts between Base64URL (JSON-safe) and ArrayBuffer (WebAuthn API).

export function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function base64ToBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Check if the browser supports WebAuthn/Passkeys. */
export function supportsWebAuthn(): boolean {
  return typeof window !== 'undefined' && !!window.PublicKeyCredential;
}

/** Convert server options JSON to WebAuthn API format. */
function optionsToPublicKey(opts: Record<string, unknown>) {
  const obj = { ...opts } as Record<string, unknown>;
  obj.challenge = base64ToBuffer(opts.challenge as string);
  if (opts.user) {
    obj.user = {
      ...(opts.user as Record<string, unknown>),
      id: base64ToBuffer((opts.user as Record<string, string>).id),
    };
  }
  if (opts.allowCredentials) {
    obj.allowCredentials = (opts.allowCredentials as Array<Record<string, string>>).map(
      (c) => ({ ...c, id: base64ToBuffer(c.id) })
    );
  }
  return obj;
}

/** Convert server's PublicKeyCredentialCreationOptionsJSON to WebAuthn API format. */
export function prepareRegistrationOptions(
  options: Record<string, unknown>
): PublicKeyCredentialCreationOptions {
  return optionsToPublicKey(options) as PublicKeyCredentialCreationOptions;
}

/** Convert server's PublicKeyCredentialRequestOptionsJSON to WebAuthn API format. */
export function prepareLoginOptions(
  options: Record<string, unknown>
): PublicKeyCredentialRequestOptions {
  return optionsToPublicKey(options) as PublicKeyCredentialRequestOptions;
}

/** Serialize a registration credential as a flat JSON object for go-webauthn. */
export function serializeRegistration(
  credential: PublicKeyCredential
): Record<string, unknown> {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: bufferToBase64(credential.rawId ?? new ArrayBuffer(0)),
    type: credential.type,
    response: {
      attestationObject: bufferToBase64(response.attestationObject),
      clientDataJSON: bufferToBase64(response.clientDataJSON),
    },
  };
}

/** Serialize an authentication credential as a flat JSON object for go-webauthn. */
export function serializeAuthentication(
  credential: PublicKeyCredential
): Record<string, unknown> {
  const response = credential.response as AuthenticatorAssertionResponse;
  const result: Record<string, unknown> = {
    id: credential.id,
    rawId: bufferToBase64(credential.rawId ?? new ArrayBuffer(0)),
    type: credential.type,
    response: {
      authenticatorData: bufferToBase64(response.authenticatorData),
      clientDataJSON: bufferToBase64(response.clientDataJSON),
      signature: bufferToBase64(response.signature),
    } as Record<string, unknown>,
  };
  // Omit userHandle entirely when null (go-webauthn expects missing key, not null).
  if (response.userHandle) {
    (result.response as Record<string, unknown>).userHandle = bufferToBase64(response.userHandle);
  }
  return result;
}
