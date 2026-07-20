export interface ChatAnnounce {
  id: string;
  identityId: string;
  destinationHash: string;
  identityHash: string;
  publicKey: string;
  displayName?: string;
  stampCost?: number;
  compressionSupported?: boolean;
  interfaceId?: string;
  hops?: number;
  heardAt: string;
}

export interface ChatContact {
  id: string;
  identityId: string;
  destinationHash: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatBlockedDestination {
  id: string;
  identityId: string;
  destinationHash: string;
  blockedAt: string;
}

export type ChatMessageDirection = 'incoming' | 'outgoing';
export type ChatMessageStatus = 'queued' | 'sending' | 'sent' | 'delivered' | 'failed';
export type ChatDeliveryRepresentation = 'opportunisticPacket' | 'directPacket' | 'directResource' | 'propagated';

export type ChatAttachmentKind = 'image' | 'audio' | 'file';

export interface ChatAttachment {
  kind: ChatAttachmentKind;
  name: string;
  mimeType: string;
  data: Uint8Array;
}

export interface ChatInboundTransfer {
  id: string;
  destinationHash?: string;
  progress: number;
  dataSize: number;
  transferSize?: number;
}

export interface ChatMessage {
  id: string;
  identityId: string;
  messageId: string;
  sourceHash: string;
  destinationHash: string;
  title: string;
  content: string;
  attachments?: ChatAttachment[];
  method?: string;
  verification?: string;
  direction?: ChatMessageDirection;
  status?: ChatMessageStatus;
  attempts?: number;
  maxAttempts?: number;
  progress?: number;
  representation?: ChatDeliveryRepresentation;
  sentUnconfirmed?: boolean;
  propagationFallbackPending?: boolean;
  timestamp?: number;
  receivedAt: string;
}

export function chatMessagePreview(message: ChatMessage): string {
  return message.content || message.title || message.attachments?.[0]?.name || '';
}

export interface ChatConversationSummary {
  destinationHash: string;
  displayName?: string;
  latestMessage: ChatMessage;
  messageCount: number;
}

export function chatConversationSummaries(
  messages: ChatMessage[],
  announces: ChatAnnounce[],
  contacts: ChatContact[] = [],
): ChatConversationSummary[] {
  const announceNames = new Map(announces.map((announce) => [announce.destinationHash, announce.displayName]));
  const contactNames = new Map(contacts.map((contact) => [contact.destinationHash, contact.name]));
  const conversations = new Map<string, ChatConversationSummary>();
  for (const message of messages) {
    const peerHash = chatMessagePeerHash(message);
    const current = conversations.get(peerHash);
    if (!current) {
      conversations.set(peerHash, {
        destinationHash: peerHash,
        displayName: contactNames.get(peerHash) ?? announceNames.get(peerHash),
        latestMessage: message,
        messageCount: 1,
      });
      continue;
    }
    current.messageCount += 1;
    if (messageTime(message) > messageTime(current.latestMessage)) current.latestMessage = message;
  }
  return Array.from(conversations.values()).sort(
    (left, right) => messageTime(right.latestMessage) - messageTime(left.latestMessage),
  );
}

export function chatMessageDirection(message: ChatMessage): ChatMessageDirection {
  return message.direction === 'outgoing' ? 'outgoing' : 'incoming';
}

export function chatMessagePeerHash(message: ChatMessage): string {
  return chatMessageDirection(message) === 'outgoing' ? message.destinationHash : message.sourceHash;
}

export function shouldUsePropagationFallback(message: ChatMessage, status: ChatMessageStatus): boolean {
  return message.direction === 'outgoing' && status === 'failed' && message.propagationFallbackPending === true;
}

export function chatMessageStatusForState(
  state: string,
  sentUnconfirmed = false,
): ChatMessageStatus | undefined {
  if (state === 'generating' || state === 'outbound') return 'queued';
  if (state === 'sending') return 'sending';
  if (state === 'sent') return 'sent';
  if (state === 'delivered') return 'delivered';
  if (state === 'failed') return sentUnconfirmed ? 'sent' : 'failed';
  if (state === 'rejected' || state === 'cancelled') return 'failed';
  return undefined;
}

export function chatMessageProgressStatus(
  state: string,
  attempts: number,
  representation: ChatDeliveryRepresentation,
): ChatMessageStatus {
  if (state === 'delivered') return 'delivered';
  // Python marks every opportunistic packet submission SENT, but the router
  // keeps that message in its outbound queue for proof-driven retries. While
  // it is still present in this live progress snapshot, present the retry
  // attempt; the terminal FAILED event becomes Sent when a packet was
  // submitted, and a proof becomes Delivered.
  if (representation === 'opportunisticPacket' && state === 'sent') return 'sending';
  if ((representation === 'directPacket' || representation === 'directResource') && state === 'sent') {
    return 'sending';
  }
  if (state === 'sent') return 'sent';
  if (state === 'sending' || attempts > 0) return 'sending';
  return 'queued';
}

export function chatDeliveryRepresentation(value: string): ChatDeliveryRepresentation | undefined {
  if (value === 'opportunisticPacket' || value === 'directPacket'
    || value === 'directResource' || value === 'propagated') return value;
  return undefined;
}

export function isUnconfirmedPacket(representation: ChatDeliveryRepresentation): boolean {
  return representation === 'opportunisticPacket';
}

export function chatMessageDisplayStatus(message: ChatMessage): ChatMessageStatus | undefined {
  if (message.status !== 'sent'
    || (message.method !== 'direct'
      && message.representation !== 'directPacket'
      && message.representation !== 'directResource')) return message.status;
  return message.attempts !== undefined && message.maxAttempts !== undefined
    && message.attempts < message.maxAttempts
    ? 'sending'
    : 'failed';
}

export function messageTime(message: ChatMessage): number {
  if (typeof message.timestamp === 'number' && Number.isFinite(message.timestamp)) return message.timestamp * 1_000;
  return Date.parse(message.receivedAt);
}

export function upsertChatAnnounce(items: ChatAnnounce[], announce: ChatAnnounce): ChatAnnounce[] {
  return [announce, ...items.filter((item) => item.id !== announce.id)]
    .sort((left, right) => Date.parse(right.heardAt) - Date.parse(left.heardAt));
}

export function upsertChatMessage(items: ChatMessage[], message: ChatMessage): ChatMessage[] {
  return [message, ...items.filter((item) => item.id !== message.id)]
    .sort((left, right) => messageTime(right) - messageTime(left));
}

export function upsertChatContact(items: ChatContact[], contact: ChatContact): ChatContact[] {
  return [contact, ...items.filter((item) => item.id !== contact.id)]
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function upsertChatBlockedDestination(
  items: ChatBlockedDestination[],
  blocked: ChatBlockedDestination,
): ChatBlockedDestination[] {
  return [blocked, ...items.filter((item) => item.id !== blocked.id)]
    .sort((left, right) => Date.parse(right.blockedAt) - Date.parse(left.blockedAt));
}
