import type { ChatAttachment } from './chat';

export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_CHAT_ATTACHMENTS = 16;

const renderableImages = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']);
const attachmentTypeOrder: Record<ChatAttachment['kind'], number> = {
  image: 0,
  audio: 1,
  file: 2,
};

export function isRenderableChatImage(mimeType: string): boolean {
  return renderableImages.has(mimeType.toLowerCase());
}

export function chatAttachmentDisplayType(attachment: ChatAttachment): ChatAttachment['kind'] {
  const mimeType = attachment.mimeType.toLowerCase().split(';', 1)[0].trim();
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('audio/')) return 'audio';
  return attachment.kind === 'audio' ? 'audio' : attachment.kind === 'image' ? 'image' : 'file';
}

export function sortChatAttachmentsForDisplay(
  attachments: readonly ChatAttachment[],
): ChatAttachment[] {
  return attachments
    .map((attachment, index) => ({ attachment, index }))
    .sort((left, right) => (
      attachmentTypeOrder[chatAttachmentDisplayType(left.attachment)]
      - attachmentTypeOrder[chatAttachmentDisplayType(right.attachment)]
      || left.index - right.index
    ))
    .map(({ attachment }) => attachment);
}

export function normalizeChatAttachments(attachments: ChatAttachment[] | undefined): ChatAttachment[] {
  if (!attachments) return [];
  const normalized: ChatAttachment[] = [];
  let totalBytes = 0;
  let hasImage = false;
  for (const attachment of attachments.slice(0, MAX_CHAT_ATTACHMENTS)) {
    const data = attachment.data instanceof Uint8Array
      ? attachment.data
      : new Uint8Array(attachment.data as ArrayLike<number>);
    totalBytes += data.byteLength;
    if (totalBytes > MAX_CHAT_ATTACHMENT_BYTES) throw new Error('LXMF_ATTACHMENTS_TOO_LARGE');
    const mimeType = normalizeMimeType(attachment.mimeType);
    let kind = attachment.kind;
    if (kind === 'image' && (!isRenderableChatImage(mimeType) || hasImage)) kind = 'file';
    if (kind === 'image') hasImage = true;
    normalized.push({
      kind,
      name: safeAttachmentName(attachment.name, defaultFileName(kind, mimeType)),
      mimeType,
      data,
    });
  }
  return normalized;
}

export function chatAttachmentBytes(attachments: ChatAttachment[] | undefined): number {
  return attachments?.reduce((total, attachment) => total + attachment.data.byteLength, 0) ?? 0;
}

export function formatChatByteSize(bytes: number): string {
  const safeBytes = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  if (safeBytes < 1_000) return `${Math.round(safeBytes)} B`;
  if (safeBytes < 1_000_000) return `${(safeBytes / 1_000).toFixed(1)} KB`;
  if (safeBytes < 1_000_000_000) return `${(safeBytes / 1_000_000).toFixed(1)} MB`;
  return `${(safeBytes / 1_000_000_000).toFixed(1)} GB`;
}

export function imageFormat(mimeType: string): string {
  return mimeType === 'image/jpeg' ? 'jpeg' : mimeType.replace(/^image\//, '') || 'image';
}

export function imageMime(format: string): string {
  const normalized = format.replace(/^image\//, '').toLowerCase();
  return normalized === 'jpg' || normalized === 'jpeg' ? 'image/jpeg' : `image/${normalized}`;
}

export function inferAttachmentMimeType(name: string): string {
  const extension = name.split('.').pop()?.toLowerCase();
  const known: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    avif: 'image/avif', webm: 'audio/webm', ogg: 'audio/ogg', m4a: 'audio/mp4', mp4: 'audio/mp4',
    pdf: 'application/pdf', txt: 'text/plain', json: 'application/json',
  };
  return extension ? known[extension] ?? 'application/octet-stream' : 'application/octet-stream';
}

export function safeAttachmentName(value: string, fallback: string): string {
  const normalized = value.normalize('NFKC').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').trim();
  return (normalized || fallback).slice(0, 255);
}

function normalizeMimeType(value: string): string {
  const normalized = value.toLowerCase().split(';', 1)[0].trim();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(normalized) ? normalized : 'application/octet-stream';
}

function defaultFileName(kind: ChatAttachment['kind'], mimeType: string): string {
  if (kind === 'audio') return 'voice-message.webm';
  if (kind === 'image') return `image.${mimeType === 'image/jpeg' ? 'jpg' : mimeType.replace(/^image\//, '')}`;
  return 'attachment.bin';
}
