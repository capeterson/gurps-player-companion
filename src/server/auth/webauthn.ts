import { createHash, randomBytes } from 'node:crypto';
import {
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { and, eq, gt, isNull, lt } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { loadConfig } from '../config.ts';
import { getDb } from '../db/client.ts';
import { passkeyChallenges } from '../db/schema.ts';

export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function b64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}
export function fromB64url(value: string): Buffer {
  return Buffer.from(value, 'base64url');
}
export function sha256(data: string | Uint8Array): Buffer {
  return createHash('sha256').update(data).digest();
}

export function webauthnRp() {
  const config = loadConfig();
  const origin = config.appBaseUrl ?? `http://localhost:${config.port}`;
  const url = new URL(origin);
  return { rpName: 'GURPS Player Companion', rpId: url.hostname, origin: url.origin };
}

export async function createChallenge(
  userId: string | null,
  purpose: 'registration' | 'authentication',
) {
  const challenge = b64url(randomBytes(32));
  const db = getDb();
  const now = new Date();
  // Purge expired rows so the table doesn't grow without bound from unauthenticated callers.
  await db.delete(passkeyChallenges).where(lt(passkeyChallenges.expiresAt, now));
  await db.insert(passkeyChallenges).values({
    challengeHash: sha256(challenge).toString('hex'),
    userId,
    purpose,
    expiresAt: new Date(now.getTime() + PASSKEY_CHALLENGE_TTL_MS),
  });
  return challenge;
}

export async function consumeChallenge(
  challenge: string,
  purpose: 'registration' | 'authentication',
) {
  const hash = sha256(challenge).toString('hex');
  const now = new Date();
  const consumed = await getDb()
    .update(passkeyChallenges)
    .set({ usedAt: now })
    .where(
      and(
        eq(passkeyChallenges.challengeHash, hash),
        eq(passkeyChallenges.purpose, purpose),
        isNull(passkeyChallenges.usedAt),
        gt(passkeyChallenges.expiresAt, now),
      ),
    )
    .returning();
  const row = consumed[0];
  if (!row) throw new HTTPException(401, { message: 'invalid passkey challenge' });
  return row;
}

/** Full W3C registration verification, including CBOR/COSE structure and alg policy. */
export async function verifyRegistration(response: RegistrationResponseJSON, challenge: string) {
  const { origin, rpId } = webauthnRp();
  try {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      expectedType: 'webauthn.create',
      requireUserPresence: true,
      requireUserVerification: true,
      // Must stay aligned with pubKeyCredParams emitted by the options route.
      supportedAlgorithmIDs: [-7, -257],
    });
    if (!result.verified || !result.registrationInfo)
      throw new HTTPException(401, { message: 'invalid passkey response' });
    return result.registrationInfo;
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(422, { message: 'invalid or unsupported passkey response' });
  }
}

/** Full W3C assertion verification, including origin/RP/flags/signature/counter checks. */
export async function verifyAssertion(args: {
  response: AuthenticationResponseJSON;
  credentialId: string;
  credentialPublicKey: string;
  signCount: number;
  challenge: string;
}) {
  const { origin, rpId } = webauthnRp();
  try {
    const result = await verifyAuthenticationResponse({
      response: args.response,
      expectedChallenge: args.challenge,
      expectedOrigin: origin,
      expectedRPID: rpId,
      expectedType: 'webauthn.get',
      requireUserVerification: true,
      credential: {
        id: args.credentialId,
        publicKey: new Uint8Array(fromB64url(args.credentialPublicKey)),
        counter: args.signCount,
      },
    });
    if (!result.verified) throw new HTTPException(401, { message: 'invalid passkey response' });
    return { signCount: result.authenticationInfo.newCounter };
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(401, { message: 'invalid passkey response' });
  }
}
