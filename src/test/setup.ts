// Pure helper/source tests run under Node without importing DOM, React or
// IndexedDB setup. Browser tests keep the same isolated setup and cleanup.
if (typeof window !== 'undefined') {
  await import('./setupBrowser.ts');
}

export {};
