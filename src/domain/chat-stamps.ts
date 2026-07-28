import type { ChatMessageStamp } from './chat';

function validCost(value: number | undefined): number | undefined {
  return Number.isInteger(value) && value !== undefined && value > 0 && value <= 254
    ? value
    : undefined;
}

export function inboundChatMessageStamp({
  requiredCost,
  stampLength,
  verification,
}: {
  requiredCost: number;
  stampLength?: number;
  verification?: string;
}): ChatMessageStamp {
  const cost = validCost(requiredCost);
  if (cost === undefined) return { status: 'notRequired' };
  if (verification !== 'valid' && verification !== 'verified') {
    return { status: 'notEvaluatedSourceUnknown' };
  }
  if (stampLength === 16) return { status: 'ticket' };
  // Signature-valid inbound messages only reach the application after
  // Leviculum accepts their required proof-of-work stamp.
  return { status: 'requiredAccepted', cost };
}

export function outboundChatMessageStamp({
  hasStamp,
  hasTicket,
  targetCost,
}: {
  hasStamp: boolean;
  hasTicket: boolean;
  targetCost?: number;
}): ChatMessageStamp {
  if (hasTicket) return { status: 'ticket' };
  const cost = validCost(targetCost);
  if (cost === undefined) return { status: 'notRequired' };
  return { status: hasStamp ? 'calculated' : 'calculating', cost };
}
