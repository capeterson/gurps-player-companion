import { afterAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { withAudit } from './auditContext.ts';
import { afterDbCommit, closeDb, getDb, runInDbTransaction } from './client.ts';
import { oauthClients } from './schema.ts';

describe('transaction and post-commit boundaries', () => {
  afterAll(closeDb);

  it('rolls back a caught 4xx savepoint and discards its post-commit hooks', async () => {
    const clientId = `rolled-back-${randomUUID()}`;
    let rolledBackHookCalled = false;
    let committedHookCalled = false;
    await runInDbTransaction(async () => {
      try {
        await withAudit(randomUUID(), undefined, async (tx) => {
          await tx.insert(oauthClients).values({
            clientId,
            name: 'Must roll back',
            redirectUris: ['http://127.0.0.1/callback'],
            allowedScopes: ['gpc:read'],
          });
          afterDbCommit(() => {
            rolledBackHookCalled = true;
          });
          throw new HTTPException(422, { message: 'expected route rejection' });
        });
      } catch (error) {
        expect(error).toBeInstanceOf(HTTPException);
      }
      afterDbCommit(() => {
        committedHookCalled = true;
      });
    });

    expect(rolledBackHookCalled).toBe(false);
    expect(committedHookCalled).toBe(true);
    expect(
      await getDb().select().from(oauthClients).where(eq(oauthClients.clientId, clientId)),
    ).toHaveLength(0);
  });
});
