import { derived, writable } from 'svelte/store';
import type { ChatAnnounce, ChatBlockedDestination, ChatContact, ChatMessage } from '../../domain/chat';

// Keep the UI-facing directory state independent from the runtime controller.
// This prevents Vite/Svelte hot replacement of runtime.ts from leaving a
// preserved ChatView subscribed to obsolete store instances.
export const chatAnnounces = writable<ChatAnnounce[]>([]);
export const chatContacts = writable<ChatContact[]>([]);
export const chatMessages = writable<ChatMessage[]>([]);
export const blockedChatDestinations = writable<ChatBlockedDestination[]>([]);
export const unreadChatMessageIds = writable<Record<string, string[]>>({});
export const unreadChatMessageCounts = derived(
  unreadChatMessageIds,
  (messages) => Object.fromEntries(
    Object.entries(messages).map(([destinationHash, messageIds]) => [destinationHash, messageIds.length]),
  ),
);
export const unreadChatMessageCount = derived(
  unreadChatMessageIds,
  (messages) => Object.values(messages).reduce((total, messageIds) => total + messageIds.length, 0),
);

export function noteUnreadChatMessage(destinationHash: string, messageId: string): void {
  unreadChatMessageIds.update((messages) => {
    const current = messages[destinationHash] ?? [];
    if (current.includes(messageId)) return messages;
    return { ...messages, [destinationHash]: [...current, messageId] };
  });
}

export function markChatMessagesRead(destinationHash?: string): void {
  if (!destinationHash) {
    unreadChatMessageIds.set({});
    return;
  }
  unreadChatMessageIds.update((messages) => {
    if (!(destinationHash in messages)) return messages;
    const remaining = { ...messages };
    delete remaining[destinationHash];
    return remaining;
  });
}

export function forgetUnreadChatMessages(messageIds: Iterable<string>): void {
  const removed = new Set(messageIds);
  if (removed.size === 0) return;
  unreadChatMessageIds.update((messages) => Object.fromEntries(
    Object.entries(messages).flatMap(([destinationHash, current]) => {
      const remaining = current.filter((messageId) => !removed.has(messageId));
      return remaining.length > 0 ? [[destinationHash, remaining]] : [];
    }),
  ));
}
