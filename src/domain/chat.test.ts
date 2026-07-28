import { describe, expect, it } from 'vitest';
import type { KnownDestinationRecord } from './known-destination';
import type { ChatContact, ChatMessage } from './chat';
import {
  chatConversationSummaries,
  chatMessageDisplayStatus,
  chatMessageProgressStatus,
  chatMessageStatusForState,
  shouldUsePropagationFallback,
  upsertChatContact,
  upsertChatMessage,
} from './chat';
import {
  assignChatMessageOrdering,
  assignChatMessageOrderings,
  compareChatMessageTimeline,
} from './chat-ordering';

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

function contact(destinationHash: string, name: string): ChatContact {
  return {
    id: `identity:${destinationHash}`,
    identityId: 'identity',
    destinationHash,
    name,
    createdAt: '2026-07-16T10:00:00.000Z',
    updatedAt: '2026-07-16T10:00:00.000Z',
  };
}

describe('chatConversationSummaries', () => {
  it('groups received messages by sender and uses the newest message first', () => {
    const aliceHash = 'a'.repeat(32);
    const destinations: KnownDestinationRecord[] = [{
      destinationHash: aliceHash,
      fullDestinationName: 'lxmf.delivery',
      displayName: 'Alice',
      lastAnnouncedAt: '2026-07-16T09:00:00.000Z',
    }];
    const summaries = chatConversationSummaries([
      message({ id: 'identity:older', messageId: 'older', timestamp: 1_752_659_000, content: 'Older' }),
      message({ id: 'identity:newer', messageId: 'newer', timestamp: 1_752_660_000, content: 'Newer' }),
      message({ id: 'identity:bob', messageId: 'bob', sourceHash: 'e'.repeat(32), timestamp: 1_752_658_000 }),
    ], destinations);

    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toMatchObject({
      destinationHash: aliceHash,
      displayName: 'Alice',
      messageCount: 2,
    });
    expect(summaries[0].latestMessage.content).toBe('Newer');
  });

  it('keeps live message updates when merging persisted chat data', () => {
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

  it('uses local receipt order for the latest conversation message', () => {
    const destinationHash = 'f'.repeat(32);
    const messages = assignChatMessageOrderings([
      message({
        id: 'identity:sent-later',
        messageId: 'sent-later',
        sourceHash: destinationHash,
        content: 'Received first',
        timestamp: 300,
        receivedAt: '2026-07-16T10:00:00.000Z',
      }),
      message({
        id: 'identity:sent-earlier',
        messageId: 'sent-earlier',
        sourceHash: destinationHash,
        content: 'Received second',
        timestamp: 100,
        receivedAt: '2026-07-16T10:01:00.000Z',
      }),
    ]);

    expect(chatConversationSummaries(messages, [])[0].latestMessage.content).toBe('Received second');
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

describe('upsertChatContact', () => {
  it('sorts contacts by name and then destination address', () => {
    const alphaLaterAddress = contact('c'.repeat(32), 'Alpha');
    const beta = contact('b'.repeat(32), 'Beta');
    const alphaEarlierAddress = contact('a'.repeat(32), 'Alpha');

    expect(upsertChatContact(
      [beta, alphaLaterAddress],
      alphaEarlierAddress,
    )).toEqual([
      alphaEarlierAddress,
      alphaLaterAddress,
      beta,
    ]);
  });
});

describe('chat message timeline ordering', () => {
  const peerHash = 'a'.repeat(32);
  const localHash = 'b'.repeat(32);

  function incoming(
    messageId: string,
    timestamp: number,
    receivedAt: string,
  ): ChatMessage {
    return message({
      id: `identity:${messageId}`,
      messageId,
      sourceHash: peerHash,
      destinationHash: localHash,
      direction: 'incoming',
      timestamp,
      receivedAt,
    });
  }

  function outgoing(
    messageId: string,
    timestamp: number,
    receivedAt: string,
  ): ChatMessage {
    return message({
      id: `identity:${messageId}`,
      messageId,
      sourceHash: localHash,
      destinationHash: peerHash,
      direction: 'outgoing',
      timestamp,
      receivedAt,
    });
  }

  function ingest(items: ChatMessage[], candidate: ChatMessage): ChatMessage[] {
    return [...items, assignChatMessageOrdering(items, candidate)];
  }

  it('sorts incoming messages by sender time inside their local receipt segment', () => {
    let items: ChatMessage[] = [];
    items = ingest(items, incoming('arrived-first', 200, '2026-07-16T10:00:00.000Z'));
    items = ingest(items, incoming('arrived-second', 100, '2026-07-16T10:01:00.000Z'));

    expect([...items].sort(compareChatMessageTimeline).map((item) => item.messageId)).toEqual([
      'arrived-second',
      'arrived-first',
    ]);
    expect(items.map((item) => item.ordering?.segment)).toEqual([0, 0]);
  });

  it('never moves a delayed incoming message across a local outgoing boundary', () => {
    let items: ChatMessage[] = [];
    items = ingest(items, incoming('before-reply', 200, '2026-07-16T10:00:00.000Z'));
    items = ingest(items, outgoing('reply', 300, '2026-07-16T10:01:00.000Z'));
    items = ingest(items, incoming('delayed', 100, '2026-07-16T10:02:00.000Z'));

    expect([...items].sort(compareChatMessageTimeline).map((item) => item.messageId)).toEqual([
      'before-reply',
      'reply',
      'delayed',
    ]);
    expect(items.map((item) => item.ordering)).toEqual([
      { segment: 0, receivedSequence: 0 },
      { segment: 1, receivedSequence: 1, boundaryReason: 'outgoing' },
      { segment: 1, receivedSequence: 2 },
    ]);
  });

  it('uses the local receive sequence when sender timestamps are equal', () => {
    let items: ChatMessage[] = [];
    items = ingest(items, incoming('first', 100, '2026-07-16T10:00:00.000Z'));
    items = ingest(items, incoming('second', 100, '2026-07-16T10:01:00.000Z'));

    expect([...items].sort(compareChatMessageTimeline).map((item) => item.messageId)).toEqual([
      'first',
      'second',
    ]);
  });

  it('allows additional boundary rules without enabling one by default', () => {
    const first = assignChatMessageOrdering([], incoming(
      'first',
      100,
      '2026-07-16T10:00:00.000Z',
    ));
    const defaultOrdered = assignChatMessageOrdering([first], incoming(
      'default',
      200,
      '2026-07-16T10:01:00.000Z',
    ));
    const policyOrdered = assignChatMessageOrdering([first], incoming(
      'policy',
      300,
      '2026-07-16T10:02:00.000Z',
    ), {
      policy: {
        additionalBoundaries: [() => ({ reason: 'test-boundary' })],
      },
    });

    expect(defaultOrdered.ordering).toMatchObject({ segment: 0 });
    expect(policyOrdered.ordering).toEqual({
      segment: 1,
      receivedSequence: 1,
      boundaryReason: 'test-boundary',
    });
  });

  it('assigns deterministic segments to legacy records from local receipt order', () => {
    const normalized = assignChatMessageOrderings([
      incoming('after-reply', 100, '2026-07-16T10:02:00.000Z'),
      outgoing('reply', 300, '2026-07-16T10:01:00.000Z'),
      incoming('before-reply', 200, '2026-07-16T10:00:00.000Z'),
    ]);
    const byId = new Map(normalized.map((item) => [item.messageId, item.ordering]));

    expect(byId.get('before-reply')).toEqual({ segment: 0, receivedSequence: 0 });
    expect(byId.get('reply')).toEqual({
      segment: 1,
      receivedSequence: 1,
      boundaryReason: 'outgoing',
    });
    expect(byId.get('after-reply')).toEqual({ segment: 1, receivedSequence: 2 });
  });
});
