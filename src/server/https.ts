import type { MiddlewareHandler } from 'hono';
import type { AppConfig } from './config.ts';

/** TLS terminates at the trusted edge; internal health probes use plain HTTP. */
export function productionHttps(config: AppConfig): MiddlewareHandler {
  if (config.environment !== 'production') {
    return async (_c, next) => {
      await next();
    };
  }
  const origin = config.appBaseUrl;
  if (!origin) {
    throw new Error('APP_BASE_URL is required for production HTTPS');
  }
  return async (c, next) => {
    if (c.req.path === '/api/v1/healthz' || c.req.path === '/api/v1/readyz') {
      await next();
      return;
    }
    const incoming = new URL(c.req.url);
    const forwardedProtocol = config.trustProxy
      ? c.req.header('x-forwarded-proto')?.split(',').at(-1)?.trim().toLowerCase()
      : undefined;
    if ((forwardedProtocol ?? incoming.protocol.replace(':', '')) !== 'https') {
      // Use the configured origin, never Host or X-Forwarded-Host. Assigning
      // pathname avoids interpreting a leading // as an external redirect.
      const target = new URL(origin);
      target.pathname = incoming.pathname;
      target.search = incoming.search;
      return c.redirect(target.toString(), 308);
    }
    await next();
    // Static files and protocol handlers return raw Responses rather than
    // c.json/c.text. Set this on the final response so their headers survive.
    c.header('Strict-Transport-Security', 'max-age=31536000');
  };
}
