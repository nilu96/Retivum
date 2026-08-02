import type { LxmfMessageAttachments } from '../../../leviculum_wasm/leviculum_wasm.js';
import type { ChatAttachment } from '../../domain/chat';

export function lxmfAttachmentInput(
  attachments: ChatAttachment[] | undefined,
): LxmfMessageAttachments | undefined {
  if (!attachments?.length) return undefined;

  const audio = attachments.find(
    (attachment) => attachment.kind === 'audio' && attachment.mimeType === 'audio/webm',
  );
  const files = attachments.filter((attachment) => attachment !== audio);

  return {
    files: files.map((file) => ({ name: file.name, data: file.data })),
    ...(audio ? { audio: { mode: 'custom' as const, data: audio.data } } : {}),
  };
}
