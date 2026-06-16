function b64urlToBuffer(value: string): ArrayBuffer {
  const base64 = value
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

function bytesToB64url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function passkeysSupported(): boolean {
  return (
    typeof window !== 'undefined' && 'PublicKeyCredential' in window && !!navigator.credentials
  );
}

export async function createPasskey(options: PublicKeyCredentialCreationOptions) {
  const credential = (await navigator.credentials.create({
    publicKey: {
      ...options,
      challenge: b64urlToBuffer(options.challenge as unknown as string),
      user: {
        ...options.user,
        id: new TextEncoder().encode(options.user.id as unknown as string).buffer as ArrayBuffer,
      },
      ...(options.excludeCredentials
        ? {
            excludeCredentials: options.excludeCredentials.map((item) => ({
              ...item,
              id: b64urlToBuffer(item.id as unknown as string),
            })),
          }
        : {}),
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error('Passkey registration was cancelled');
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: bytesToB64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bytesToB64url(response.clientDataJSON),
      attestationObject: bytesToB64url(response.attestationObject),
    },
  };
}

export async function getPasskey(options: PublicKeyCredentialRequestOptions) {
  const credential = (await navigator.credentials.get({
    publicKey: {
      ...options,
      challenge: b64urlToBuffer(options.challenge as unknown as string),
      ...(options.allowCredentials
        ? {
            allowCredentials: options.allowCredentials.map((item) => ({
              ...item,
              id: b64urlToBuffer(item.id as unknown as string),
            })),
          }
        : {}),
    },
  })) as PublicKeyCredential | null;
  if (!credential) throw new Error('Passkey sign-in was cancelled');
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: bytesToB64url(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: bytesToB64url(response.clientDataJSON),
      authenticatorData: bytesToB64url(response.authenticatorData),
      signature: bytesToB64url(response.signature),
      userHandle: response.userHandle ? bytesToB64url(response.userHandle) : null,
    },
  };
}
