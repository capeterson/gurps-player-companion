import { createHash, createPublicKey, randomBytes, verify as verifySignature } from 'node:crypto';
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
  await db
    .insert(passkeyChallenges)
    .values({
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

export function parseClientData(jsonB64: string, expectedChallenge: string, expectedType: string) {
  const parsed = JSON.parse(fromB64url(jsonB64).toString('utf8')) as {
    type?: string;
    challenge?: string;
    origin?: string;
  };
  const { origin } = webauthnRp();
  if (
    parsed.type !== expectedType ||
    parsed.challenge !== expectedChallenge ||
    parsed.origin !== origin
  ) {
    throw new HTTPException(401, { message: 'invalid passkey response' });
  }
  return parsed;
}

type CoseKey = {
  kty?: number;
  alg?: number;
  crv?: number;
  x?: Buffer;
  y?: Buffer;
  n?: Buffer;
  e?: Buffer;
};

type Cbor = number | bigint | Buffer | string | Cbor[] | Map<Cbor, Cbor> | boolean | null;
function readCbor(buf: Buffer, offset = 0): [Cbor, number] {
  let cursor = offset;
  const first = buf[cursor++];
  if (first === undefined) throw new Error('truncated CBOR');
  const major = first >> 5;
  const add = first & 31;
  let len: number;
  if (add < 24) len = add;
  else if (add === 24) {
    const next = buf[cursor++];
    if (next === undefined) throw new Error('truncated CBOR');
    len = next;
  } else if (add === 25) {
    len = buf.readUInt16BE(cursor);
    cursor += 2;
  } else if (add === 26) {
    len = buf.readUInt32BE(cursor);
    cursor += 4;
  } else throw new Error('unsupported CBOR length');
  if (major === 0) return [len, cursor];
  if (major === 1) return [-1 - len, cursor];
  if (major === 2) return [buf.subarray(cursor, cursor + len), cursor + len];
  if (major === 3) return [buf.subarray(cursor, cursor + len).toString('utf8'), cursor + len];
  if (major === 4) {
    const a: Cbor[] = [];
    for (let i = 0; i < len; i++) {
      const r = readCbor(buf, cursor);
      a.push(r[0]);
      cursor = r[1];
    }
    return [a, cursor];
  }
  if (major === 5) {
    const m = new Map<Cbor, Cbor>();
    for (let i = 0; i < len; i++) {
      const k = readCbor(buf, cursor);
      const v = readCbor(buf, k[1]);
      m.set(k[0], v[0]);
      cursor = v[1];
    }
    return [m, cursor];
  }
  if (major === 7) return [add === 20 ? false : add === 21 ? true : null, cursor];
  throw new Error('unsupported CBOR');
}
function coseFromMap(map: Map<Cbor, Cbor>): CoseKey {
  return {
    kty: map.get(1) as number,
    alg: map.get(3) as number,
    crv: map.get(-1) as number,
    x: map.get(-2) as Buffer,
    y: map.get(-3) as Buffer,
    n: map.get(-1) as Buffer,
    e: map.get(-2) as Buffer,
  };
}
export function extractAttestation(attestationObjectB64: string) {
  const [att] = readCbor(fromB64url(attestationObjectB64));
  if (!(att instanceof Map)) throw new HTTPException(401, { message: 'invalid attestation' });
  const authData = att.get('authData') as Buffer;
  if (!Buffer.isBuffer(authData) || authData.length < 55)
    throw new HTTPException(401, { message: 'invalid attestation' });
  const { rpId } = webauthnRp();
  if (!authData.subarray(0, 32).equals(sha256(rpId)))
    throw new HTTPException(401, { message: 'invalid passkey rp' });
  const flags = authData[32] ?? 0;
  // Require UP (0x01), UV (0x04), and AT (0x40) during registration.
  if ((flags & 0x01) === 0 || (flags & 0x04) === 0 || (flags & 0x40) === 0)
    throw new HTTPException(401, { message: 'user verification required' });
  const signCount = authData.readUInt32BE(33);
  let offset = 37 + 16;
  const credentialIdLength = authData.readUInt16BE(offset);
  offset += 2;
  const credentialId = authData.subarray(offset, offset + credentialIdLength);
  offset += credentialIdLength;
  const [cose] = readCbor(authData, offset);
  if (!(cose instanceof Map)) throw new HTTPException(401, { message: 'invalid credential key' });
  return {
    credentialId: b64url(credentialId),
    publicKey: b64url(authData.subarray(offset)),
    signCount,
    alg: cose.get(3) as number,
  };
}

function jwkFor(coseB64: string): JsonWebKey & { alg: string } {
  const [cose] = readCbor(fromB64url(coseB64));
  if (!(cose instanceof Map)) throw new HTTPException(401, { message: 'invalid credential key' });
  const key = coseFromMap(cose);
  if (key.kty === 2 && key.alg === -7 && key.crv === 1 && key.x && key.y)
    return { kty: 'EC', crv: 'P-256', x: b64url(key.x), y: b64url(key.y), alg: 'ES256', ext: true };
  if (key.kty === 3 && key.alg === -257 && key.n && key.e)
    return { kty: 'RSA', n: b64url(key.n), e: b64url(key.e), alg: 'RS256', ext: true };
  throw new HTTPException(422, { message: 'unsupported passkey algorithm' });
}

export async function verifyAssertion(args: {
  credentialPublicKey: string;
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
  challenge: string;
}) {
  parseClientData(args.clientDataJSON, args.challenge, 'webauthn.get');
  const authData = fromB64url(args.authenticatorData);
  const { rpId } = webauthnRp();
  // Require both UP (0x01) and UV (0x04): passwordless login must verify the user.
  if (!authData.subarray(0, 32).equals(sha256(rpId)) || ((authData[32] ?? 0) & 0x05) !== 0x05) {
    throw new HTTPException(401, { message: 'invalid passkey response' });
  }
  const data = Buffer.concat([authData, sha256(fromB64url(args.clientDataJSON))]);
  const publicKey = createPublicKey({ key: jwkFor(args.credentialPublicKey), format: 'jwk' });
  const ok = verifySignature('sha256', data, publicKey, fromB64url(args.signature));
  if (!ok) throw new HTTPException(401, { message: 'invalid passkey signature' });
  return { signCount: authData.readUInt32BE(33) };
}
