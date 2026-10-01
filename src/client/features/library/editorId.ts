let fallbackSequence = 0;

/** Create a local editor key, including on non-secure HTTP origins. */
export function newEditorId(): string {
  const runtimeCrypto = globalThis.crypto;
  if (typeof runtimeCrypto?.randomUUID === 'function') return runtimeCrypto.randomUUID();

  fallbackSequence += 1;
  return `${Date.now().toString(36)}-${fallbackSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
}
