const MAX_DIAGNOSTIC_ERROR_LENGTH = 240;

export function diagnosticErrorMessage(error: unknown): string {
  let message: string;
  try {
    message = typeof error === 'string'
      ? error
      : error instanceof Error
        ? error.message
        : String(error);
  } catch {
    return 'Unknown error';
  }
  const normalized = message.replace(/\s+/g, ' ').trim();
  return normalized.slice(0, MAX_DIAGNOSTIC_ERROR_LENGTH) || 'Unknown error';
}
