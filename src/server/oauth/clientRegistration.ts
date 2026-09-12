import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import {
  type OAuthClientMetadataDocument,
  oauthClientMetadataDocument,
} from '../../shared/schemas/oauth.ts';

const MAX_METADATA_BYTES = 64 * 1024;
const METADATA_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_MS = 5 * 60_000;
const MAX_CACHE_MS = 60 * 60_000;

export class ClientRegistrationError extends Error {
  constructor(
    readonly code: 'invalid_redirect_uri' | 'invalid_client_metadata',
    message: string,
  ) {
    super(message);
    this.name = 'ClientRegistrationError';
  }
}

export function isSafeOAuthRedirectUri(value: string): boolean {
  try {
    const uri = new URL(value);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(uri.hostname);
    return (
      (uri.protocol === 'https:' || (uri.protocol === 'http:' && loopback)) &&
      !uri.username &&
      !uri.password &&
      !uri.hash
    );
  } catch {
    return false;
  }
}

/**
 * Match a requested redirect against a registered redirect URI.
 *
 * Native applications bind a temporary local listener to an ephemeral port.
 * RFC 8252 therefore requires authorization servers to allow any port on an
 * otherwise exact IP-loopback redirect. Codex also publishes a portless
 * localhost fallback, so we apply the same narrow rule to localhost. All
 * non-loopback redirects, and every component except the port, remain exact.
 */
export function oauthRedirectUriMatches(registeredValue: string, requestedValue: string): boolean {
  if (registeredValue === requestedValue) return true;
  if (!isSafeOAuthRedirectUri(registeredValue) || !isSafeOAuthRedirectUri(requestedValue)) {
    return false;
  }

  const registered = new URL(registeredValue);
  const requested = new URL(requestedValue);
  const loopbackHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
  return (
    registered.protocol === 'http:' &&
    requested.protocol === 'http:' &&
    loopbackHosts.has(registered.hostname) &&
    registered.hostname === requested.hostname &&
    registered.port === '' &&
    registered.pathname === requested.pathname &&
    registered.search === requested.search
  );
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a = 0, b = 0] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0) return false;
  return true;
}

function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isPublicIpv4(address);
  if (family !== 6) return false;
  // URL serialization canonicalizes expanded IPv6 spellings before the
  // prefix/range checks (for example 0:0:0:0:0:0:0:1 -> ::1).
  const hostname = new URL(`http://[${address}]/`).hostname;
  const normalized = hostname.slice(1, -1).toLowerCase();
  const [firstText = '', secondText = '0'] = normalized.split(':');
  const first = Number.parseInt(firstText, 16);
  const second = Number.parseInt(secondText || '0', 16);
  if (
    // Globally routable unicast currently lives in 2000::/3. Fail closed for
    // link-local, unique-local, multicast, translation and reserved space.
    first < 0x2000 ||
    first > 0x3fff ||
    normalized === '::' ||
    normalized === '::1' ||
    normalized.startsWith('::ffff:') ||
    (first === 0x2001 && second <= 0x01ff) ||
    normalized.startsWith('2001:db8:') ||
    normalized.startsWith('2002:')
  ) {
    return false;
  }
  return true;
}

function metadataUrl(clientId: string): URL {
  let url: URL;
  try {
    url = new URL(clientId);
  } catch {
    throw new ClientRegistrationError('invalid_client_metadata', 'client_id is not a URL');
  }
  if (
    url.protocol !== 'https:' ||
    url.pathname === '/' ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== '443')
  ) {
    throw new ClientRegistrationError(
      'invalid_client_metadata',
      'CIMD client_id must be a public HTTPS URL with a path',
    );
  }
  return url;
}

async function resolvePublicAddress(hostname: string): Promise<{ address: string; family: 4 | 6 }> {
  const bareHostname = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  const literalFamily = isIP(bareHostname);
  const addresses = literalFamily
    ? [{ address: bareHostname, family: literalFamily as 4 | 6 }]
    : await lookup(bareHostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((entry) => !isPublicIp(entry.address))) {
    throw new ClientRegistrationError(
      'invalid_client_metadata',
      'CIMD hostname must resolve only to public addresses',
    );
  }
  const selected = addresses[0];
  if (!selected) {
    throw new ClientRegistrationError('invalid_client_metadata', 'CIMD hostname has no address');
  }
  return { address: selected.address, family: selected.family as 4 | 6 };
}

export interface MetadataResponse {
  body: unknown;
  cacheMs: number;
}

export type MetadataReader = (url: URL) => Promise<MetadataResponse>;

export const readPublicClientMetadata: MetadataReader = async (url) => {
  const selected = await resolvePublicAddress(url.hostname);
  return new Promise<MetadataResponse>((resolve, reject) => {
    const request = httpsRequest(
      url,
      {
        method: 'GET',
        headers: {
          accept: 'application/json, application/oauth-client-metadata+json',
          'user-agent': 'gurps-player-companion-oauth/1.0',
        },
        lookup: ((_hostname: string, _options: unknown, callback: CallableFunction) =>
          callback(null, selected.address, selected.family)) as never,
      },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          reject(
            new ClientRegistrationError(
              'invalid_client_metadata',
              `CIMD endpoint returned HTTP ${response.statusCode ?? 0}`,
            ),
          );
          return;
        }
        const contentType = response.headers['content-type']?.split(';', 1)[0]?.trim();
        if (
          contentType !== 'application/json' &&
          contentType !== 'application/oauth-client-metadata+json'
        ) {
          response.resume();
          reject(
            new ClientRegistrationError(
              'invalid_client_metadata',
              'CIMD endpoint must return JSON',
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > MAX_METADATA_BYTES) {
            response.destroy(
              new ClientRegistrationError('invalid_client_metadata', 'CIMD response is too large'),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => {
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
            const maxAge = /(?:^|,)\s*max-age=(\d+)/i.exec(
              response.headers['cache-control'] ?? '',
            )?.[1];
            const requestedCacheMs = maxAge ? Number(maxAge) * 1000 : DEFAULT_CACHE_MS;
            resolve({ body, cacheMs: Math.min(MAX_CACHE_MS, Math.max(0, requestedCacheMs)) });
          } catch {
            reject(
              new ClientRegistrationError('invalid_client_metadata', 'CIMD response is not JSON'),
            );
          }
        });
      },
    );
    request.setTimeout(METADATA_TIMEOUT_MS, () => {
      request.destroy(
        new ClientRegistrationError('invalid_client_metadata', 'CIMD request timed out'),
      );
    });
    request.on('error', reject);
    request.end();
  });
};

export async function fetchClientMetadataDocument(
  clientId: string,
  reader: MetadataReader = readPublicClientMetadata,
): Promise<{ metadata: OAuthClientMetadataDocument; expiresAt: Date }> {
  const url = metadataUrl(clientId);
  let response: MetadataResponse;
  try {
    response = await reader(url);
  } catch (error) {
    if (error instanceof ClientRegistrationError) throw error;
    throw new ClientRegistrationError(
      'invalid_client_metadata',
      'CIMD document could not be retrieved',
    );
  }
  const { body } = response;
  const cacheMs = Math.min(MAX_CACHE_MS, Math.max(0, response.cacheMs));
  const parsed = oauthClientMetadataDocument.safeParse(body);
  if (!parsed.success) {
    throw new ClientRegistrationError(
      'invalid_client_metadata',
      'CIMD document has invalid client metadata',
    );
  }
  if (parsed.data.client_id !== clientId) {
    throw new ClientRegistrationError(
      'invalid_client_metadata',
      'CIMD document client_id does not match its URL',
    );
  }
  if (parsed.data.redirect_uris.some((redirect) => !isSafeOAuthRedirectUri(redirect))) {
    throw new ClientRegistrationError(
      'invalid_redirect_uri',
      'CIMD document contains an unsafe redirect URI',
    );
  }
  const methods =
    parsed.data.token_endpoint_auth_methods_supported ??
    (parsed.data.token_endpoint_auth_method ? [parsed.data.token_endpoint_auth_method] : ['none']);
  if (!methods.includes('none')) {
    throw new ClientRegistrationError(
      'invalid_client_metadata',
      'CIMD client must support public-client token exchange',
    );
  }
  if (parsed.data.grant_types && !parsed.data.grant_types.includes('authorization_code')) {
    throw new ClientRegistrationError(
      'invalid_client_metadata',
      'CIMD client must support the authorization_code grant',
    );
  }
  return { metadata: parsed.data, expiresAt: new Date(Date.now() + cacheMs) };
}
