/** Fetch rejection has no server outcome; it is expected during offline use. */
export class NetworkUnavailableError extends Error {
  constructor(message = 'Offline', options?: ErrorOptions) {
    super(message, options);
    this.name = 'NetworkUnavailableError';
  }
}

export function isNetworkErrorMessage(message: string): boolean {
  return /^(?:Offline|Failed to fetch|Failed to Fetch|Load failed|NetworkError when attempting to fetch resource\.?|The Internet connection appears to be offline\.?|A network error occurred\.?)$/.test(
    message,
  );
}

export function isNetworkError(error: unknown): boolean {
  return (
    error instanceof NetworkUnavailableError ||
    (error instanceof Error && error.name !== 'ApiError' && isNetworkErrorMessage(error.message))
  );
}
