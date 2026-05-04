/**
 * Password hashing wrapper.  Uses Bun's built-in argon2id (no native deps).
 *
 * `verifyPassword` is timing-safe by design: the wrapped argon2 verify
 * uses constant-time comparison, AND callers should always run a verify
 * even when the user isn't found (use `dummyPasswordHash` as the input)
 * so the response time doesn't leak whether an email exists.
 */

const ARGON2_OPTIONS = {
  algorithm: 'argon2id' as const,
  memoryCost: 19_456, // 19 MB — RFC 9106 recommended baseline
  timeCost: 2,
};

export async function hashPassword(plaintext: string): Promise<string> {
  if (typeof Bun === 'undefined' || !Bun.password?.hash) {
    throw new Error('Bun.password is not available; this code must run under Bun');
  }
  return Bun.password.hash(plaintext, ARGON2_OPTIONS);
}

export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  if (typeof Bun === 'undefined' || !Bun.password?.verify) {
    throw new Error('Bun.password is not available; this code must run under Bun');
  }
  try {
    return await Bun.password.verify(plaintext, hash, ARGON2_OPTIONS.algorithm);
  } catch {
    return false;
  }
}

/**
 * Use this hash for comparison when no user matches — it lets the
 * argon2 verify run anyway so the timing of "user not found" matches
 * "wrong password".  Initialised lazily on first access.
 */
let _dummyPasswordHash: string | undefined;

export async function getDummyPasswordHash(): Promise<string> {
  if (_dummyPasswordHash) return _dummyPasswordHash;
  _dummyPasswordHash = await hashPassword('dummy-password-for-timing-safety');
  return _dummyPasswordHash;
}
