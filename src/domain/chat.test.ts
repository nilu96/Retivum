import { describe, expect, it } from 'vitest';
import type { ChatAnnounce, ChatContact, ChatMessage } from './chat';
import {
  chatConversationSummaries,
  chatMessageDisplayStatus,
  chatMessageProgressStatus,
  chatMessageStatusForState,
  shouldUsePropagationFallback,
  upsertChatAnnounce,
  upsertChatMessage,
} from './chat';

function message(overrides: Partial<ChatMessage>): ChatMessage {
  return {
    id: 'identity:message',
    identityId: 'identity',
    messageId: 'message',
    sourceHash: 'a'.repeat(32),
    destinationHash: 'b'.repeat(32),
    title: '',
    content: 'Hello',
    receivedAt: '2026-07-16T10:00:00.000Z',
    ...overrides,
  };
}

describe('chatConversationSummaries', () => {
  it('groups received messages by sender and uses the newest message first', () => {
    const aliceHash = 'a'.repeat(32);
    const announces: ChatAnnounce[] = [{
      id: `identity:${aliceHash}`,
      identityId: 'identity',
      destinationHash: aliceHash,
      identityHash: 'c'.repeat(32),
      publicKey: 'd'.repeat(128),
      displayName: 'Alice',
      heardAt: '2026-07-16T09:00:00.000Z',
    }];
    const summaries = chatConversationSummaries([
      message({ id: 'identity:older', messageId: 'older', timestamp: 1_752_659_000, content: 'Older' }),
      message({ id: 'identity:newer', messageId: 'newer', timestamp: 1_752_660_000, content: 'Newer' }),
      message({ id: 'identity:bob', messageId: 'bob', sourceHash: 'e'.repeat(32), timestamp: 1_752_658_000 }),
    ], announces);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      destinationHash: aliceHash,
      displayName: 'Alice',
      messageCount: 2,
    });
    expect(summaries[0].latestMessage.content).toBe('Newer');
  });

  it('keeps live announce and message updates when merging persisted directory data', () => {
    const destinationHash = 'a'.repeat(32);
    const persistedAnnounce: ChatAnnounce = {
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      identityHash: 'b'.repeat(32),
      publicKey: 'c'.repeat(128),
      displayName: 'Old name',
      heardAt: '2026-07-16T10:00:00.000Z',
    };
    const liveAnnounce = { ...persistedAnnounce, displayName: 'Live name', heardAt: '2026-07-16T10:01:00.000Z' };
    expect(upsertChatAnnounce([persistedAnnounce], liveAnnounce)).toEqual([liveAnnounce]);

    const persistedMessage = message({ content: 'Persisted' });
    const liveMessage = message({ content: 'Live', receivedAt: '2026-07-16T10:01:00.000Z' });
    expect(upsertChatMessage([persistedMessage], liveMessage)).toEqual([liveMessage]);
  });

  it('groups outgoing messages by recipient and prefers a local contact name', () => {
    const destinationHash = 'f'.repeat(32);
    const contacts: ChatContact[] = [{
      id: `identity:${destinationHash}`,
      identityId: 'identity',
      destinationHash,
      name: 'Local name',
      createdAt: '2026-07-16T10:00:00.000Z',
      updatedAt: '2026-07-16T10:00:00.000Z',
    }];
    const summaries = chatConversationSummaries([
      message({
        direction: 'outgoing',
        sourceHash: '1'.repeat(32),
        destinationHash,
        content: 'Outbound',
      }),
    ], [], contacts);

    expect(summaries[0]).toMatchObject({ destinationHash, displayName: 'Local name' });
  });

  it('uses propagation fallback only for a failed outgoing primary attempt that opted in', () => {
    const outbound = message({ direction: 'outgoing', status: 'sending', propagationFallbackPending: true });
    expect(shouldUsePropagationFallback(outbound, 'failed')).toBe(true);
    expect(shouldUsePropagationFallback(outbound, 'sent')).toBe(false);
    expect(shouldUsePropagationFallback({ ...outbound, propagationFallbackPending: false }, 'failed')).toBe(false);
    expect(shouldUsePropagationFallback({ ...outbound, direction: 'incoming' }, 'failed')).toBe(false);
  });

  it('keeps an unconfirmed submitted packet sent when delivery attempts expire', () => {
    expect(chatMessageStatusForState('failed', true)).toBe('sent');
    expect(chatMessageStatusForState('failed', false)).toBe('failed');
    expect(chatMessageStatusForState('delivered', true)).toBe('delivered');
  });

  it('distinguishes packet submission from an in-progress resource transfer', () => {
    expect(chatMessageProgressStatus('sending', 1, 'directPacket')).toBe('sending');
    expect(chatMessageProgressStatus('sent', 1, 'opportunisticPacket')).toBe('sending');
    expect(chatMessageProgressStatus('sending', 1, 'directResource')).toBe('sending');
    expect(chatMessageProgressStatus('outbound', 2, 'directPacket')).toBe('sending');
    expect(chatMessageProgressStatus('outbound', 0, 'directPacket')).toBe('queued');
  });

  it('never presents a direct-link message as sent without proof', () => {
    expect(chatMessageDisplayStatus(message({
      direction: 'outgoing',
      method: 'direct',
      representation: 'directPacket',
      status: 'sent',
      attempts: 2,
      maxAttempts: 5,
    }))).toBe('sending');
    expect(chatMessageDisplayStatus(message({
      direction: 'outgoing',
      method: 'direct',
      representation: 'directPacket',
      status: 'sent',
      attempts: 5,
      maxAttempts: 5,
    }))).toBe('failed');
  });
});
