import { eq } from 'drizzle-orm';
import { hashPassword } from '../../auth/password.ts';
import { getDb } from '../client.ts';
import { users } from '../schema.ts';

export const DEMO_PASSWORD = 'change-me-please-this-is-a-seed-account';

/** Existing passwords, profile changes and suspension state are never reset. */
export async function ensureDemoUser(email: string, displayName: string) {
  const db = getDb();
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  if (existing) return existing;
  const [created] = await db
    .insert(users)
    .values({ email, displayName, passwordHash: await hashPassword(DEMO_PASSWORD) })
    .onConflictDoNothing({ target: users.email })
    .returning();
  if (created) return created;
  const [concurrent] = await db.select().from(users).where(eq(users.email, email));
  if (!concurrent) throw new Error(`Failed to create demo account ${email}`);
  return concurrent;
}
