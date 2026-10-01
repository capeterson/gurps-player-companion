import { randomUUID } from 'node:crypto';
import { signAccessToken } from './auth/jwt.ts';
import { hashPassword } from './auth/password.ts';
import { getDb } from './db/client.ts';
import { users } from './db/schema.ts';

let passwordHash: Promise<string> | undefined;

/** Fresh authenticated actors for non-auth integration tests. Account creation
 * and password security remain covered by the real auth/transport suites. */
export async function createTestActor(label: string) {
  passwordHash ??= hashPassword('TestPassword1!');
  const email = `test-${label}-${randomUUID()}@example.invalid`;
  const [user] = await getDb()
    .insert(users)
    .values({ email, displayName: `Test ${label}`, passwordHash: await passwordHash })
    .returning();
  if (!user) throw new Error(`Missing test actor ${label}`);
  const { token: accessToken } = await signAccessToken(user.id, user.authVersion);
  return { accessToken, token: accessToken, email, userId: user.id };
}
