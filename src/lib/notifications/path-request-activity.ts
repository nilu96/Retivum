import { startDestinationPathRequest } from '../../infrastructure/reticulum/path-request-operations';
import { liveActivity } from './toasts';

export interface DestinationPathRequestActivity {
  result: Promise<void>;
  cancel: () => void;
}

/** Starts a cancellable replacement path request and presents its lifecycle globally. */
export function showDestinationPathRequestActivity(
  destinationHash: string,
): DestinationPathRequestActivity | undefined {
  const request = startDestinationPathRequest(destinationHash);
  if (!request) return undefined;
  const destination = shortHash(destinationHash);
  const activity = liveActivity.start(
    'pathManagement.activity.pending',
    { destination },
    request.cancel,
  );
  const result = request.result.then((requestResult) => {
    if (requestResult.code === 'PATH_REQUEST_CANCELLED') {
      activity.dismiss();
      return;
    }
    if (requestResult.ok) {
      activity.success(
        requestResult.hops === undefined
          ? 'pathManagement.activity.success'
          : requestResult.hops === 1
            ? 'pathManagement.activity.successOneHop'
            : 'pathManagement.activity.successManyHops',
        {
          destination,
          ...(requestResult.hops === undefined ? {} : { count: requestResult.hops }),
        },
      );
      return;
    }
    activity.error(
      requestResult.code === 'PATH_REQUEST_TIMEOUT'
        ? 'pathManagement.activity.timeout'
        : 'pathManagement.activity.failed',
      { destination },
    );
  }).catch(() => {
    activity.error('pathManagement.activity.failed', { destination });
  });
  return { result, cancel: request.cancel };
}

function shortHash(value: string): string {
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}
