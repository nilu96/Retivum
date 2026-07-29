import { describe, expect, it } from 'vitest';
import { diagnosticErrorMessage } from './diagnostic-error';

describe('diagnosticErrorMessage', () => {
  it('extracts and normalizes an Error message', () => {
    expect(diagnosticErrorMessage(new Error('Invalid\n  propagation data')))
      .toBe('Invalid propagation data');
  });

  it('bounds messages originating from untrusted parser input', () => {
    expect(diagnosticErrorMessage('x'.repeat(300))).toBe('x'.repeat(240));
  });

  it('uses a stable fallback for empty or unprintable errors', () => {
    expect(diagnosticErrorMessage('  ')).toBe('Unknown error');
    expect(diagnosticErrorMessage({ toString: () => { throw new Error('no value'); } }))
      .toBe('Unknown error');
  });
});
