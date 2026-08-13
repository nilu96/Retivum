export type ResourceTransferEventDisposition = 'stage' | 'start' | 'update' | 'ignore';

/**
 * WASM emits authenticated advertisement metadata immediately before the
 * authoritative Core acceptance/start event. Only the receiver-side start may
 * create an inbound transfer; later events are relevant only for that start.
 */
export function classifyInboundResourceEvent(
  type: string,
  isSender: boolean | undefined,
  hasAcceptedStart: boolean,
): ResourceTransferEventDisposition {
  if (isSender === true) return 'ignore';
  if (type === 'resourceAdvertisementReceived') return 'stage';
  if (type === 'resourceTransferStarted' && isSender === false) return 'start';
  if (
    hasAcceptedStart
    && (type === 'resourceProgress' || type === 'resourceCompleted' || type === 'resourceFailed')
  ) return 'update';
  return 'ignore';
}
