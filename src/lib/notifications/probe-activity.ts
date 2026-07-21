import { get } from 'svelte/store';
import { t } from '../../i18n';
import { startDestinationProbe } from '../../infrastructure/reticulum/probe-operations';
import { liveActivity } from './toasts';

export interface DestinationProbeActivityOptions {
  destinationHash: string;
  displayName?: string;
  fullDestinationName: string;
  timeoutMs: number;
  probeSizeBytes?: number;
}

/** Starts a cancellable probe and presents its lifecycle in the toast viewport. */
export function showDestinationProbeActivity(options: DestinationProbeActivityOptions): boolean {
  const destination = shortHash(options.destinationHash);
  const displayName = options.displayName?.trim();
  const hasName = Boolean(displayName
    && displayName !== destination
    && displayName !== options.destinationHash);
  const pendingProbe = startDestinationProbe(
    options.destinationHash,
    options.fullDestinationName,
    options.timeoutMs,
    options.probeSizeBytes ?? 8,
  );
  if (!pendingProbe) return false;

  const activity = liveActivity.start(
    hasName ? 'probe.activity.pendingNamed' : 'probe.activity.pending',
    { destination, ...(hasName ? { name: displayName! } : {}) },
    pendingProbe.cancel,
  );
  void pendingProbe.result.then((result) => {
    if (result.code === 'PROBE_CANCELLED') {
      activity.dismiss();
      return;
    }
    if (result.ok) {
      const translate = get(t);
      const duration = result.roundTripTimeMs === undefined
        ? translate('probe.activity.durationUnknown')
        : translate('probe.history.rtt.seconds', { value: (result.roundTripTimeMs / 1_000).toFixed(1) });
      activity.success(
        hasName ? 'probe.activity.successNamed' : 'probe.activity.success',
        { destination, duration, ...(hasName ? { name: displayName! } : {}) },
      );
      return;
    }
    if (result.code === 'PROBE_DESTINATION_UNKNOWN') {
      activity.error(
        hasName ? 'probe.activity.identityUnknownNamed' : 'probe.activity.identityUnknown',
        { destination, ...(hasName ? { name: displayName! } : {}) },
      );
      return;
    }
    activity.error(
      hasName ? 'probe.activity.failureNamed' : 'probe.activity.failure',
      { destination, ...(hasName ? { name: displayName! } : {}) },
    );
  }).catch(() => {
    activity.error(
      hasName ? 'probe.activity.failureNamed' : 'probe.activity.failure',
      { destination, ...(hasName ? { name: displayName! } : {}) },
    );
  });
  return true;
}

function shortHash(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}
