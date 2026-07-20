import { describe, expect, it } from 'vitest';
import {
  bytesToBase64,
  identityAnnounceIsDue,
  parseIdentityBackup,
  parseIdentityFile,
  upsertIdentitySummary,
  type PersistedIdentityRecord,
} from './identity';

describe('identity backups', () => {
  it('parses a versioned Retivum private-key backup', () => {
    const privateKey = new Uint8Array([1, 2, 3, 4]);
    const parsed = parseIdentityBackup(JSON.stringify({
      format: 'retivum-identity',
      version: 1,
      label: 'Travel',
      displayName: 'Alice',
      identityHash: '0123456789abcdef0123456789abcdef',
      privateKey: bytesToBase64(privateKey),
      exportedAt: '2026-07-16T00:00:00.000Z',
    }));

    expect(parsed).toMatchObject({
      label: 'Travel',
      displayName: 'Alice',
      expectedIdentityHash: '0123456789abcdef0123456789abcdef',
    });
    expect(Array.from(parsed?.privateKey ?? [])).toEqual([1, 2, 3, 4]);
  });

  it('rejects malformed and unsupported backups', () => {
    expect(parseIdentityBackup('{}')).toBeUndefined();
    expect(parseIdentityBackup('{')).toBeUndefined();
  });

  it('accepts the standard raw 64-byte Reticulum identity format', () => {
    const privateKey = Uint8Array.from({ length: 64 }, (_, index) => index);
    const parsed = parseIdentityFile(privateKey);

    expect(parsed?.label).toBe('');
    expect(parsed?.displayName).toBe('');
    expect(parsed?.expectedIdentityHash).toBeUndefined();
    expect(Array.from(parsed?.privateKey ?? [])).toEqual(Array.from(privateKey));
    expect(parseIdentityFile(new Uint8Array(63))).toBeUndefined();
  });

  it('retains import compatibility with the earlier Retivum JSON backup', () => {
    const json = JSON.stringify({
      format: 'retivum-identity',
      version: 1,
      label: 'JSON identity',
      displayName: 'Alice',
      identityHash: '0123456789abcdef0123456789abcdef',
      privateKey: bytesToBase64(new Uint8Array(64)),
      exportedAt: '2026-07-16T00:00:00.000Z',
    });
    expect(parseIdentityFile(new TextEncoder().encode(json))?.displayName).toBe('Alice');
  });
});

describe('identity list updates', () => {
  it('updates an existing identity without changing list order', () => {
    const first = { id: 'first', displayName: 'Alice', identityHashHex: '01', publicKeyHex: '02' };
    const second = { id: 'second', displayName: 'Bob', identityHashHex: '03', publicKeyHex: '04' };
    const updatedFirst = { ...first, displayName: 'Alice updated' };

    expect(upsertIdentitySummary([first, second], updatedFirst)).toEqual([updatedFirst, second]);
    expect(upsertIdentitySummary([first], second)).toEqual([first, second]);
  });
});

describe('identity announce history', () => {
  const record = {
    lastAnnouncedAt: '2026-07-19T10:00:00.000Z',
  } as unknown as PersistedIdentityRecord;

  it('tracks one configured interval for the identity', () => {
    expect(identityAnnounceIsDue(record, 30, Date.parse('2026-07-19T10:29:59.999Z'))).toBe(false);
    expect(identityAnnounceIsDue(record, 30, Date.parse('2026-07-19T10:30:00.000Z'))).toBe(true);
    expect(identityAnnounceIsDue({ ...record, lastAnnouncedAt: 'not-a-date' }, 30, Date.now())).toBe(true);
  });

  it('keeps Never from becoming due', () => {
    expect(identityAnnounceIsDue(undefined, 0, Date.now())).toBe(false);
  });
});
