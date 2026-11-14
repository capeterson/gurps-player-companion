/** Validate navigation state without changing OAuth parameters or sheet fragments. */
export function safeReturnDestination(candidate: unknown, area: 'player' | 'admin'): string {
  const fallback = area === 'admin' ? '/admin/users' : '/';
  if (typeof candidate !== 'string' || !candidate.startsWith('/') || candidate.startsWith('//'))
    return fallback;
  if (
    candidate.includes('\\') ||
    [...candidate].some((char) => {
      const code = char.charCodeAt(0);
      return code < 32 || code === 127;
    })
  )
    return fallback;
  const path = candidate.split(/[?#]/, 1)[0] ?? '';
  // Encoded separators, dot segments and repeated encodings must never be
  // interpreted as a different route by the browser or a router.
  let decoded = path;
  try {
    for (let i = 0; i < 4; i++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return fallback;
  }
  if (decoded !== path || /(^|\/)\.{1,2}(\/|$)/.test(path)) return fallback;
  try {
    // Also reject malformed percent escapes in query and fragment without
    // normalizing the candidate: OAuth state must survive byte for byte.
    decodeURIComponent(candidate);
    const url = new URL(candidate, 'https://internal.invalid');
    if (url.origin !== 'https://internal.invalid' || url.pathname !== path) return fallback;
  } catch {
    return fallback;
  }
  const id = '[A-Za-z0-9-]+';
  const routes =
    area === 'admin'
      ? [
          /^\/admin$/,
          /^\/admin\/(?:media|users|campaigns)$/,
          new RegExp(`^/admin/(?:users|campaigns)/${id}$`),
        ]
      : [
          /^\/$/,
          /^\/(?:characters|campaigns|settings|recycle-bin|about)$/,
          /^\/help\/campaign-library$/,
          /^\/oauth\/consent$/,
          new RegExp(`^/characters/${id}$`),
          new RegExp(
            `^/campaigns/${id}(?:/(?:log|library|library-transfer|history|encounters|gm))?$`,
          ),
          new RegExp(`^/campaigns/${id}/encounters/${id}$`),
        ];
  return routes.some((route) => route.test(path)) ? candidate : fallback;
}
