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
  return optionsToPublicKey(options) as unknown as PublicKeyCredentialCreationOptions;
}

/** Convert server's PublicKeyCredentialRequestOptionsJSON to WebAuthn API format. */
export function prepareLoginOptions(
  options: Record<string, unknown>
): PublicKeyCredentialRequestOptions {
  return optionsToPublicKey(options) as unknown as PublicKeyCredentialRequestOptions;
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

/** Run a fresh passkey ceremony and return a single-use reauth token for
 * sensitive account actions ("use passkey instead of password").
 * The caller injects the API functions to keep this module UI-agnostic. */
export async function reauthWithPasskey(
  begin: () => Promise<{ options: Record<string, unknown> }>,
  finish: (credential: Record<string, unknown>) => Promise<{ reauth_token?: string }>,
): Promise<string> {
  if (!supportsWebAuthn()) {
    throw new Error("passkeysUnsupported");
  }
  const optionsData = await begin();
  const wrapped = optionsData.options as Record<string, unknown>;
  if (!wrapped) throw new Error("passkeysNoOptions");
  const options = (wrapped.publicKey ?? wrapped) as Record<string, unknown>;
  const publicKey = prepareLoginOptions(options);
  const credential = await navigator.credentials.get({ publicKey });
  if (!credential) throw new Error("passkeyReauthCancelled");
  const serialized = serializeAuthentication(credential as PublicKeyCredential);
  const result = await finish(serialized);
  if (!result?.reauth_token) throw new Error("passkeyReauthFailed");
  return result.reauth_token;
}

/** Short human label for a stored User-Agent ("Chrome · iOS").
 * The backend stores the raw UA at registration; this is display-only. */
export function describeUserAgent(ua: string | undefined | null): string | null {
  if (!ua) return null;
  let os = "";
  if (/iPhone|iPad|iPod/i.test(ua)) os = "iOS";
  else if (/Android/i.test(ua)) os = "Android";
  else if (/Windows/i.test(ua)) os = "Windows";
  else if (/Mac OS/i.test(ua)) os = "macOS";
  else if (/Linux/i.test(ua)) os = "Linux";
  let browser = "";
  if (/Edg\//i.test(ua)) browser = "Edge";
  else if (/OPR\//i.test(ua) || /Opera/i.test(ua)) browser = "Opera";
  else if (/YaBrowser/i.test(ua)) browser = "YaBrowser";
  else if (/Chrome/i.test(ua) && !/Edg\//i.test(ua)) browser = "Chrome";
  else if (/Firefox|FxiOS/i.test(ua)) browser = "Firefox";
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = "Safari";
  const parts = [browser, os].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}
