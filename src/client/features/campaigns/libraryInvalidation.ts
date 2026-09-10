import type { QueryClient } from '@tanstack/react-query';

let invalidate: ((campaignId: string) => void) | null = null;

export function mountLibraryInvalidations(queryClient: QueryClient): () => void {
  const callback = (campaignId: string) => {
    void queryClient.invalidateQueries({ queryKey: ['campaigns', campaignId, 'library'] });
  };
  invalidate = callback;
  return () => {
    if (invalidate === callback) invalidate = null;
  };
}

export function invalidateLibrary(campaignId: string): void {
  invalidate?.(campaignId);
}
