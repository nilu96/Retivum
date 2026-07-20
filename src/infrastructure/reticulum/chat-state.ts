import { derived, writable } from 'svelte/store';
import type { ChatAnnounce, ChatBlockedDestination, ChatContact, ChatMessage } from '../../domain/chat';

// Keep the UI-facing directory state independent from the runtime controller.
// This prevents Vite/Svelte hot replacement of runtime.ts from leaving a
// preserved ChatView subscribed to obsolete store instances.
export const chatAnnounces = writable<ChatAnnounce[]>([]);
export const chatContacts = writable<ChatContact[]>([]);
export const chatMessages = writable<ChatMessage[]>([]);
export const blockedChatDestinations = writable<ChatBlockedDestination[]>([]);
export const unreadChatMessageCounts = writable<Record<string, number>>({});
export const unreadChatMessageCount = derived(
  unreadChatMessageCounts,
  (counts) => Object.values(counts).reduce((total, count) => total + count, 0),
);

export function noteUnreadChatMessage(destinationHash: string): void {
  unreadChatMessageCounts.update((counts) => ({
    ...counts,
    [destinationHash]: (counts[destinationHash] ?? 0) + 1,
  }));
}

export function markChatMessagesRead(destinationHash?: string): void {
  if (!destinationHash) {
    unreadChatMessageCounts.set({});
    return;
  }
  unreadChatMessageCounts.update((counts) => {
    if (!(destinationHash in counts)) return counts;
    const remaining = { ...counts };
    delete remaining[destinationHash];
    return remaining;
  });
}
