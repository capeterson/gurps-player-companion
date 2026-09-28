import { afterAll, describe, expect, it, spyOn } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AuthenticatedUser } from '../auth/session.ts';
import type { AppConfig } from '../config.ts';
import { closeDb, getDb } from '../db/client.ts';
import { oauthAccessTokens, oauthClients, oauthGrants, users } from '../db/schema.ts';
import { configureIntegrationTestEnvironment, integrationTestConfig } from '../testConfig.ts';
import * as clientRegistration from './clientRegistration.ts';
import {
  beginAuthorization,
  mcpResource,
  resolveOAuthAccessToken,
  syncConfiguredOAuthClients,
} from './service.ts';

configureIntegrationTestEnvironment();

const redirectUri = 'https://client.example/callback';

async function actor(): Promise<AuthenticatedUser> {
  const [user] = await getDb()
    .insert(users)
    .values({
      email: `oauth-configured-${randomUUID()}@example.com`,
      displayName: 'Configured client tester',
      passwordHash: 'not-a-login-credential',
    })
    .returning();
  if (!user) throw new Error('test actor creation failed');
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    suspendedAt: null,
    authVersion: user.authVersion,
    authMethod: 'jwt',
    authenticatedAt: Math.floor(Date.now() / 1000),
  };
}

function authorization(config: AppConfig, clientId: string) {
  return {
    response_type: 'code' as const,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: 'a'.repeat(43),
    code_challenge_method: 'S256' as const,
    scope: 'gpc:read',
    state: randomUUID(),
    resource: mcpResource(config),
  };
}

function metadata(clientId: string) {
  return {
    metadata: { client_id: clientId, redirect_uris: [redirectUri], client_name: 'CIMD client' },
    expiresAt: new Date(Date.now() + 60_000),
  };
}

describe('configured OAuth client authority', () => {
  afterAll(closeDb);

  it('cannot resurrect a removed HTTPS configured client or its existing tokens through CIMD', async () => {
    const clientId = `https://client.example/${randomUUID()}.json`;
    const config: AppConfig = {
      ...integrationTestConfig,
      oauthClients: [
        { clientId, name: 'Configured client', redirectUris: [redirectUri], scopes: ['gpc:read'] },
      ],
    };
    const user = await actor();
    const fetchMetadata = spyOn(
      clientRegistration,
      'fetchClientMetadataDocument',
    ).mockResolvedValue(metadata(clientId));
    try {
      await syncConfiguredOAuthClients(config);
      const [client] = await getDb()
        .select()
        .from(oauthClients)
        .where(eq(oauthClients.clientId, clientId));
      if (!client) throw new Error('configured client missing');
      const [grant] = await getDb()
        .insert(oauthGrants)
        .values({
          userId: user.id,
          clientId: client.id,
          scopes: ['gpc:read'],
          resource: mcpResource(config),
          authVersion: user.authVersion,
        })
        .returning();
      if (!grant) throw new Error('test grant missing');
      const token = `gpco_${randomUUID()}`;
      await getDb()
        .insert(oauthAccessTokens)
        .values({
          grantId: grant.id,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          scopes: ['gpc:read'],
          expiresAt: new Date(Date.now() + 60_000),
        });
      expect((await resolveOAuthAccessToken(config, token, mcpResource(config))).grantId).toBe(
        grant.id,
      );

      config.oauthClients = [];
      await expect(
        resolveOAuthAccessToken(config, token, mcpResource(config)),
      ).rejects.toMatchObject({ code: 'invalid_token' });
      await expect(
        beginAuthorization(config, user, authorization(config, clientId)),
      ).rejects.toMatchObject({ code: 'invalid_client' });
      expect(fetchMetadata).not.toHaveBeenCalled();
      await expect(
        resolveOAuthAccessToken(config, token, mcpResource(config)),
      ).rejects.toMatchObject({ code: 'invalid_token' });
      const [retained] = await getDb()
        .select()
        .from(oauthClients)
        .where(eq(oauthClients.id, client.id));
      expect(retained?.registrationMethod).toBe('configured');
      expect(retained?.disabledAt).not.toBeNull();
      expect(retained?.allowedScopes).toEqual(['gpc:read']);
    } finally {
      fetchMetadata.mockRestore();
      await getDb().delete(oauthClients).where(eq(oauthClients.clientId, clientId));
      await getDb().delete(users).where(eq(users.id, user.id));
    }
  });

  for (const concurrentChange of ['configured', 'disabled'] as const) {
    it(`preserves a client ${concurrentChange} while its expired metadata is being fetched`, async () => {
      const clientId = `https://client.example/${randomUUID()}.json`;
      const config: AppConfig = { ...integrationTestConfig, oauthClients: [] };
      const user = await actor();
      await getDb()
        .insert(oauthClients)
        .values({
          clientId,
          name: 'Expired CIMD client',
          redirectUris: [redirectUri],
          allowedScopes: ['gpc:read'],
          registrationMethod: 'cimd',
          metadataExpiresAt: new Date(0),
        });
      const fetchMetadata = spyOn(
        clientRegistration,
        'fetchClientMetadataDocument',
      ).mockImplementation(async () => {
        await getDb()
          .update(oauthClients)
          .set(
            concurrentChange === 'configured'
              ? { registrationMethod: 'configured', name: 'Operator configuration' }
              : { disabledAt: new Date() },
          )
          .where(eq(oauthClients.clientId, clientId));
        return metadata(clientId);
      });
      try {
        await expect(
          beginAuthorization(config, user, authorization(config, clientId)),
        ).rejects.toMatchObject({ code: 'invalid_client' });
        expect(fetchMetadata).toHaveBeenCalledTimes(1);
        const [retained] = await getDb()
          .select()
          .from(oauthClients)
          .where(eq(oauthClients.clientId, clientId));
        expect(retained?.allowedScopes).toEqual(['gpc:read']);
        if (concurrentChange === 'configured') {
          expect(retained?.registrationMethod).toBe('configured');
          expect(retained?.name).toBe('Operator configuration');
        } else {
          expect(retained?.disabledAt).not.toBeNull();
        }
      } finally {
        fetchMetadata.mockRestore();
        await getDb().delete(oauthClients).where(eq(oauthClients.clientId, clientId));
        await getDb().delete(users).where(eq(users.id, user.id));
      }
    });
  }
});
