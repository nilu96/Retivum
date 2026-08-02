import { describe, expect, it } from 'vitest';
import type { ChatAttachment } from '../../domain/chat';
import { lxmfAttachmentInput } from './lxmf-attachments';

describe('LXMF attachment mapping', () => {
  it('preserves the filenames of all selected images', () => {
    const attachments: ChatAttachment[] = [
      {
        kind: 'image',
        name: 'holiday-original.jpg',
        mimeType: 'image/jpeg',
        data: new Uint8Array([1, 2]),
      },
      {
        kind: 'file',
        name: 'map.png',
        mimeType: 'image/png',
        data: new Uint8Array([3, 4]),
      },
    ];

    expect(lxmfAttachmentInput(attachments)).toEqual({
      files: [
        { name: 'holiday-original.jpg', data: new Uint8Array([1, 2]) },
        { name: 'map.png', data: new Uint8Array([3, 4]) },
      ],
    });
  });

  it('keeps recorded WebM audio in the standard LXMF audio field', () => {
    const audio: ChatAttachment = {
      kind: 'audio',
      name: 'voice-message.webm',
      mimeType: 'audio/webm',
      data: new Uint8Array([5, 6]),
    };

    expect(lxmfAttachmentInput([audio])).toEqual({
      files: [],
      audio: { mode: 'custom', data: new Uint8Array([5, 6]) },
    });
  });
});
