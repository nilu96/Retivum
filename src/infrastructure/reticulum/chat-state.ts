import { derived, writable } from 'svelte/store';
import type { ChatBlockedDestination, ChatContact, ChatMessage } from '../../domain/chat';
import type { LxmfPropagationSyncResult } from './protocol';

// Keep the UI-facing directory state independent from the runtime controller.
// This prevents Vite/Svelte hot replacement of runtime.ts from leaving a
// preserved ChatView subscribed to obsolete store instances.
export const chatContacts = writable<ChatContact[]>([]);
export const chatMessages = writable<ChatMessage[]>([]);
export const chatDirectoryReady = writable(false);
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

type IncomingChatMessageListener = (message: ChatMessage) => void;
const incomingChatMessageListeners = new Set<IncomingChatMessageListener>();
type AutomaticPropagationSyncListener = (result: LxmfPropagationSyncResult) => void;
const automaticPropagationSyncListeners = new Set<AutomaticPropagationSyncListener>();

export function onIncomingChatMessage(listener: IncomingChatMessageListener): () => void {
  incomingChatMessageListeners.add(listener);
  return () => incomingChatMessageListeners.delete(listener);
}

export function emitIncomingChatMessage(message: ChatMessage): void {
  for (const listener of incomingChatMessageListeners) {
    try {
      listener(message);
    } catch {
      // Foreground notification listeners must not disrupt message handling.
    }
  }
}

export function onAutomaticPropagationSyncComplete(
  listener: AutomaticPropagationSyncListener,
): () => void {
  automaticPropagationSyncListeners.add(listener);
  return () => automaticPropagationSyncListeners.delete(listener);
}

export function emitAutomaticPropagationSyncComplete(result: LxmfPropagationSyncResult): void {
  for (const listener of automaticPropagationSyncListeners) {
    try {
      listener(result);
    } catch {
      // Foreground notification listeners must not disrupt sync result handling.
    }
  }
}

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
