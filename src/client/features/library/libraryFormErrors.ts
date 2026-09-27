interface ValidationIssue {
  path: (string | number)[];
  message: string;
}

export function libraryValidationIssues(error: unknown): ValidationIssue[] {
  if (!error || typeof error !== 'object' || !('issues' in error)) return [];
  return Array.isArray(error.issues) ? (error.issues as ValidationIssue[]) : [];
}

/** Keep validation actionable without exposing a serialized Zod error to players. */
export function libraryFormError(
  error: unknown,
  labels: Readonly<Record<string, string>> = {},
): string {
  const issues = libraryValidationIssues(error);
  if (issues.length) {
    return issues
      .slice(0, 4)
      .map((issue) => {
        const path = issue.path
          .map((part) => labels[String(part)] ?? String(part).replace(/([a-z])([A-Z])/g, '$1 $2'))
          .join(' → ');
        return path ? `${path}: ${issue.message}` : issue.message;
      })
      .join('; ');
  }
  return error instanceof Error ? error.message : 'Check the entry and try saving again.';
}
