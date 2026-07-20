export type ResourceTransferEventDisposition = 'stage' | 'start' | 'update' | 'ignore';

/**
 * Raw advertisement inspection happens before Reticulum Core packet filtering.
 * It may supply metadata, but only an accepted receiver-side start may create
 * an inbound transfer. Later events are relevant only for that accepted start.
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
