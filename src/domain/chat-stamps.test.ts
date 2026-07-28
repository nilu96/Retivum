import { describe, expect, it } from 'vitest';
import { inboundChatMessageStamp, outboundChatMessageStamp } from './chat-stamps';

describe('chat message stamp metadata', () => {
  it('records the exact accepted inbound policy outcome', () => {
    expect(inboundChatMessageStamp({
      requiredCost: 12,
      stampLength: 32,
      verification: 'valid',
    })).toEqual({ status: 'requiredAccepted', cost: 12 });
    expect(inboundChatMessageStamp({
      requiredCost: 12,
      stampLength: 16,
      verification: 'valid',
    })).toEqual({ status: 'ticket' });
    expect(inboundChatMessageStamp({
      requiredCost: 0,
      verification: 'valid',
    })).toEqual({ status: 'notRequired' });
    expect(inboundChatMessageStamp({
      requiredCost: 12,
      stampLength: 32,
      verification: 'unverified',
    })).toEqual({ status: 'notEvaluatedSourceUnknown' });
  });

  it('distinguishes outbound ticket stamps, calculation, and no requirement', () => {
    expect(outboundChatMessageStamp({
      hasStamp: true,
      hasTicket: true,
      targetCost: 12,
    })).toEqual({ status: 'ticket' });
    expect(outboundChatMessageStamp({
      hasStamp: false,
      hasTicket: false,
      targetCost: 12,
    })).toEqual({ status: 'calculating', cost: 12 });
    expect(outboundChatMessageStamp({
      hasStamp: true,
      hasTicket: false,
      targetCost: 12,
    })).toEqual({ status: 'calculated', cost: 12 });
    expect(outboundChatMessageStamp({
      hasStamp: false,
      hasTicket: false,
    })).toEqual({ status: 'notRequired' });
  });
});
