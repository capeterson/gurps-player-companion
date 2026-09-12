import { describe, expect, it } from 'bun:test';
import {
  ClientRegistrationError,
  fetchClientMetadataDocument,
  isSafeOAuthRedirectUri,
  readPublicClientMetadata,
} from './clientRegistration.ts';

describe('OAuth client registration', () => {
  it('accepts HTTPS and loopback HTTP redirects only', () => {
    expect(isSafeOAuthRedirectUri('https://chatgpt.com/connector/oauth/callback')).toBe(true);
    expect(isSafeOAuthRedirectUri('http://127.0.0.1:49152/callback')).toBe(true);
    expect(isSafeOAuthRedirectUri('http://localhost:49152/callback')).toBe(true);
    expect(isSafeOAuthRedirectUri('http://claude.example/callback')).toBe(false);
    expect(isSafeOAuthRedirectUri('https://user:pass@example.com/callback')).toBe(false);
    expect(isSafeOAuthRedirectUri('https://example.com/callback#fragment')).toBe(false);
  });

  it('validates a public-client metadata document and caps its cache lifetime', async () => {
    const clientId = 'https://chatgpt.com/oauth/client/example.json';
    const before = Date.now();
    const result = await fetchClientMetadataDocument(clientId, async () => ({
      body: {
        client_id: clientId,
        client_name: 'ChatGPT',
        redirect_uris: ['https://chatgpt.com/connector/oauth/callback'],
        token_endpoint_auth_methods_supported: ['private_key_jwt', 'none'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        client_uri: 'https://chatgpt.com',
      },
      cacheMs: 24 * 60 * 60_000,
    }));
    expect(result.metadata.client_name).toBe('ChatGPT');
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 60 * 60_000);
    expect(result.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 60 * 60_000);
  });

  it('rejects metadata whose identity or public-client capabilities do not match', async () => {
    const clientId = 'https://client.example/oauth.json';
    const base = {
      client_id: clientId,
      client_name: 'Example',
      redirect_uris: ['https://client.example/callback'],
      grant_types: ['authorization_code'] as const,
      response_types: ['code'] as const,
    };
    await expect(
      fetchClientMetadataDocument(clientId, async () => ({
        body: { ...base, client_id: 'https://attacker.example/oauth.json' },
        cacheMs: 1,
      })),
    ).rejects.toMatchObject({ code: 'invalid_client_metadata' });
    await expect(
      fetchClientMetadataDocument(clientId, async () => ({
        body: { ...base, token_endpoint_auth_method: 'private_key_jwt' },
        cacheMs: 1,
      })),
    ).rejects.toMatchObject({ code: 'invalid_client_metadata' });
  });

  it('refuses private metadata hosts before making an HTTPS request', async () => {
    await expect(
      readPublicClientMetadata(new URL('https://127.0.0.1/client.json')),
    ).rejects.toBeInstanceOf(ClientRegistrationError);
    await expect(
      readPublicClientMetadata(new URL('https://[0:0:0:0:0:0:0:1]/client.json')),
    ).rejects.toBeInstanceOf(ClientRegistrationError);
    await expect(
      readPublicClientMetadata(new URL('https://[2001::1]/client.json')),
    ).rejects.toBeInstanceOf(ClientRegistrationError);
  });
});
