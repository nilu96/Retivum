import { describe, expect, it } from 'vitest';
import {
  chatAttachmentDisplayType,
  formatChatByteSize,
  MAX_CHAT_ATTACHMENT_BYTES,
  normalizeChatAttachments,
  sortChatAttachmentsForDisplay,
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

  it('stably sorts images before audio and other files by their media type', () => {
    const attachments = [
      { kind: 'file' as const, name: 'notes.txt', mimeType: 'text/plain', data: new Uint8Array([1]) },
      { kind: 'file' as const, name: 'second.png', mimeType: 'image/png', data: new Uint8Array([2]) },
      { kind: 'file' as const, name: 'recording.m4a', mimeType: 'audio/mp4', data: new Uint8Array([3]) },
      { kind: 'image' as const, name: 'first.jpg', mimeType: 'image/jpeg', data: new Uint8Array([4]) },
      { kind: 'audio' as const, name: 'legacy-audio', mimeType: 'application/octet-stream', data: new Uint8Array([5]) },
      { kind: 'file' as const, name: 'document.pdf', mimeType: 'application/pdf', data: new Uint8Array([6]) },
    ];

    expect(sortChatAttachmentsForDisplay(attachments).map((attachment) => attachment.name)).toEqual([
      'second.png',
      'first.jpg',
      'recording.m4a',
      'legacy-audio',
      'notes.txt',
      'document.pdf',
    ]);
    expect(attachments.map((attachment) => attachment.name)).toEqual([
      'notes.txt',
      'second.png',
      'recording.m4a',
      'first.jpg',
      'legacy-audio',
      'document.pdf',
    ]);
    expect(chatAttachmentDisplayType(attachments[1])).toBe('image');
    expect(chatAttachmentDisplayType(attachments[2])).toBe('audio');
  });

  it('formats byte sizes with decimal SI units', () => {
    expect(formatChatByteSize(999)).toBe('999 B');
    expect(formatChatByteSize(4_096)).toBe('4.1 KB');
    expect(formatChatByteSize(MAX_CHAT_ATTACHMENT_BYTES)).toBe('10.5 MB');
    expect(formatChatByteSize(1_000_000_000)).toBe('1.0 GB');
  });
});
