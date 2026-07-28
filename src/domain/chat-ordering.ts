import type { ChatMessage, ChatMessageOrdering } from './chat';
import {
  chatMessageActivityTime,
  chatMessageDirection,
  chatMessagePeerHash,
  messageTime,
} from './chat';

export interface ChatOrderBoundaryContext {
  candidate: ChatMessage;
  conversationMessages: readonly ChatMessage[];
  currentSegmentMessages: readonly ChatMessage[];
}

export interface ChatOrderBoundaryDecision {
  reason: string;
}

export type ChatOrderBoundaryRule = (
  context: ChatOrderBoundaryContext,
) => ChatOrderBoundaryDecision | undefined;

export interface ChatOrderingPolicy {
  additionalBoundaries: readonly ChatOrderBoundaryRule[];
}

export const defaultChatOrderingPolicy: ChatOrderingPolicy = {
  additionalBoundaries: [],
};

export function compareChatMessageTimeline(left: ChatMessage, right: ChatMessage): number {
  if (sameChatConversation(left, right)
    && validChatMessageOrdering(left.ordering)
    && validChatMessageOrdering(right.ordering)) {
    const segmentOrder = left.ordering.segment - right.ordering.segment;
    if (segmentOrder !== 0) return segmentOrder;

    const directionOrder = directionPosition(left) - directionPosition(right);
    if (directionOrder !== 0) return directionOrder;

    return finiteTime(messageTime(left)) - finiteTime(messageTime(right))
      || left.ordering.receivedSequence - right.ordering.receivedSequence
      || left.id.localeCompare(right.id);
  }
  return finiteTime(messageTime(left)) - finiteTime(messageTime(right))
    || finiteTime(chatMessageActivityTime(left)) - finiteTime(chatMessageActivityTime(right))
    || left.id.localeCompare(right.id);
}

export function assignChatMessageOrdering(
  items: readonly ChatMessage[],
  candidate: ChatMessage,
  options: {
    replacesMessageId?: string;
    policy?: ChatOrderingPolicy;
  } = {},
): ChatMessage {
  const existing = items.find((item) => (
    item.id === candidate.id
    || (options.replacesMessageId !== undefined && item.id === options.replacesMessageId)
  ));
  if (existing
    && sameChatConversation(existing, candidate)
    && validChatMessageOrdering(existing.ordering)) {
    return { ...candidate, ordering: existing.ordering };
  }
  if (validChatMessageOrdering(candidate.ordering)) return candidate;

  const conversationMessages = assignChatMessageOrderings(items.filter((item) => (
    sameChatConversation(item, candidate)
  ))).sort((left, right) => (
    (left.ordering?.receivedSequence ?? -1) - (right.ordering?.receivedSequence ?? -1)
  ));
  const latestSegment = conversationMessages.reduce(
    (maximum, message) => Math.max(maximum, message.ordering?.segment ?? -1),
    -1,
  );
  const receivedSequence = conversationMessages.reduce(
    (maximum, message) => Math.max(maximum, message.ordering?.receivedSequence ?? -1),
    -1,
  ) + 1;
  const currentSegmentMessages = latestSegment < 0
    ? []
    : conversationMessages.filter((message) => message.ordering?.segment === latestSegment);
  const policy = options.policy ?? defaultChatOrderingPolicy;
  const additionalBoundary = chatMessageDirection(candidate) === 'incoming'
    ? policy.additionalBoundaries
      .map((rule) => rule({ candidate, conversationMessages, currentSegmentMessages }))
      .find((decision) => decision !== undefined)
    : undefined;
  const startsSegment = latestSegment < 0
    || chatMessageDirection(candidate) === 'outgoing'
    || additionalBoundary !== undefined;

  return {
    ...candidate,
    ordering: {
      segment: startsSegment ? latestSegment + 1 : latestSegment,
      receivedSequence,
      ...(chatMessageDirection(candidate) === 'outgoing'
        ? { boundaryReason: 'outgoing' }
        : additionalBoundary
          ? { boundaryReason: additionalBoundary.reason }
          : {}),
    },
  };
}

/**
 * Assigns deterministic ordering metadata to legacy records using their local
 * receipt order. A partially assigned set is rebuilt as one receipt timeline.
 */
export function assignChatMessageOrderings(items: readonly ChatMessage[]): ChatMessage[] {
  if (items.every((message) => validChatMessageOrdering(message.ordering))) return [...items];

  const result: ChatMessage[] = [];
  const ordered = [...items].sort((left, right) => (
    finiteTime(chatMessageActivityTime(left)) - finiteTime(chatMessageActivityTime(right))
    || finiteTime(messageTime(left)) - finiteTime(messageTime(right))
    || left.id.localeCompare(right.id)
  ));
  for (const message of ordered) result.push(assignChatMessageOrdering(result, {
    ...message,
    ordering: undefined,
  }));
  return result;
}

function validChatMessageOrdering(
  value: ChatMessageOrdering | undefined,
): value is ChatMessageOrdering {
  return value !== undefined
    && Number.isSafeInteger(value.segment)
    && value.segment >= 0
    && Number.isSafeInteger(value.receivedSequence)
    && value.receivedSequence >= 0;
}

function sameChatConversation(left: ChatMessage, right: ChatMessage): boolean {
  return left.identityId === right.identityId
    && chatMessagePeerHash(left) === chatMessagePeerHash(right);
}

function directionPosition(message: ChatMessage): number {
  return chatMessageDirection(message) === 'outgoing' ? 0 : 1;
}

function finiteTime(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
