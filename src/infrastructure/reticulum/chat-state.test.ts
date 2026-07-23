import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  forgetUnreadChatMessages,
  markChatMessagesRead,
  noteUnreadChatMessage,
  unreadChatMessageCount,
  unreadChatMessageCounts,
  unreadChatMessageIds,
} from './chat-state';

describe('chat unread state', () => {
  beforeEach(() => markChatMessagesRead());

  it('counts unread messages per conversation and in total', () => {
    noteUnreadChatMessage('alice', 'alice-1');
    noteUnreadChatMessage('alice', 'alice-2');
    noteUnreadChatMessage('bob', 'bob-1');
    expect(get(unreadChatMessageCounts)).toEqual({ alice: 2, bob: 1 });
    expect(get(unreadChatMessageIds)).toEqual({ alice: ['alice-1', 'alice-2'], bob: ['bob-1'] });
    expect(get(unreadChatMessageCount)).toBe(3);

    markChatMessagesRead('alice');
    expect(get(unreadChatMessageCounts)).toEqual({ bob: 1 });
    expect(get(unreadChatMessageCount)).toBe(1);
  });

  it('does not count the same unread message twice', () => {
    noteUnreadChatMessage('alice', 'alice-1');
    noteUnreadChatMessage('alice', 'alice-1');

    expect(get(unreadChatMessageCounts)).toEqual({ alice: 1 });
  });

  it('forgets only unread messages removed from local history', () => {
    noteUnreadChatMessage('alice', 'alice-1');
    noteUnreadChatMessage('alice', 'alice-2');
    noteUnreadChatMessage('bob', 'bob-1');

    forgetUnreadChatMessages(['alice-1', 'bob-1']);

    expect(get(unreadChatMessageIds)).toEqual({ alice: ['alice-2'] });
  });
});
