import { describe, expect, it } from 'vitest';
import { classifyInboundResourceEvent } from './resource-transfer-events';

describe('inbound Resource event classification', () => {
  it('does not expose a raw or reflected UDP advertisement as an inbound transfer', () => {
    expect(classifyInboundResourceEvent('resourceAdvertisementReceived', undefined, false)).toBe('stage');
    expect(classifyInboundResourceEvent('resourceProgress', false, false)).toBe('ignore');
    expect(classifyInboundResourceEvent('resourceTransferStarted', true, false)).toBe('ignore');
  });

  it('starts only after Core accepts the receiver-side Resource', () => {
    expect(classifyInboundResourceEvent('resourceTransferStarted', false, false)).toBe('start');
    expect(classifyInboundResourceEvent('resourceProgress', false, true)).toBe('update');
    expect(classifyInboundResourceEvent('resourceCompleted', false, true)).toBe('update');
  });
});
