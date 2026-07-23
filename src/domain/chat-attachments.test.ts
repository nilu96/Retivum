import { describe, expect, it } from 'vitest';
import {
  formatChatByteSize,
  MAX_CHAT_ATTACHMENT_BYTES,
  normalizeChatAttachments,
} from './chat-attachments';

describe('chat attachment policy', () => {
  it('keeps one standard image and preserves playable audio attachments', () => {
    const items = normalizeChatAttachments([
      { kind: 'image', name: 'one.png', mimeType: 'image/png', data: new Uint8Array([1]) },
      { kind: 'image', name: 'two.png', mimeType: 'image/png', data: new Uint8Array([2]) },
      { kind: 'audio', name: 'one.webm', mimeType: 'audio/webm;codecs=opus', data: new Uint8Array([3]) },
      { kind: 'audio', name: 'two.webm', mimeType: 'audio/webm', data: new Uint8Array([4]) },
    ]);
    expect(items.map((item) => item.kind)).toEqual(['image', 'file', 'audio', 'audio']);
    expect(items[2].mimeType).toBe('audio/webm');
  });

  it('rejects a message whose combined attachments exceed the local limit', () => {
    expect(() => normalizeChatAttachments([{
      kind: 'file',
      name: 'large.bin',
      mimeType: 'application/octet-stream',
      data: new Uint8Array(MAX_CHAT_ATTACHMENT_BYTES + 1),
    }])).toThrow('LXMF_ATTACHMENTS_TOO_LARGE');
  });

  it('formats byte sizes with decimal SI units', () => {
    expect(formatChatByteSize(999)).toBe('999 B');
    expect(formatChatByteSize(4_096)).toBe('4.1 KB');
    expect(formatChatByteSize(MAX_CHAT_ATTACHMENT_BYTES)).toBe('10.5 MB');
    expect(formatChatByteSize(1_000_000_000)).toBe('1.0 GB');
  });
});
