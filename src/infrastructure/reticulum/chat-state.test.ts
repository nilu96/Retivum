import { get } from 'svelte/store';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  markChatMessagesRead,
  noteUnreadChatMessage,
  unreadChatMessageCount,
  unreadChatMessageCounts,
} from './chat-state';

describe('chat unread state', () => {
  beforeEach(() => markChatMessagesRead());

  it('counts unread messages per conversation and in total', () => {
    noteUnreadChatMessage('alice');
    noteUnreadChatMessage('alice');
    noteUnreadChatMessage('bob');
    expect(get(unreadChatMessageCounts)).toEqual({ alice: 2, bob: 1 });
    expect(get(unreadChatMessageCount)).toBe(3);

    markChatMessagesRead('alice');
    expect(get(unreadChatMessageCounts)).toEqual({ bob: 1 });
    expect(get(unreadChatMessageCount)).toBe(1);
  });
});
