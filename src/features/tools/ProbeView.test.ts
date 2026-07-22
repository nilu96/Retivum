import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  knownDestinationHashes,
  reticulumRuntime,
  runtimeStatus,
} from '../../infrastructure/reticulum/runtime';
import { clearProbeHistory } from '../../infrastructure/reticulum/probe-history';
import ToastViewport from '../../lib/components/ToastViewport.svelte';
import { clearToasts } from '../../lib/notifications/toasts';
import ProbeView from './ProbeView.svelte';

describe('ProbeView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearProbeHistory();
    clearToasts();
    runtimeStatus.set('online');
    knownDestinationHashes.set(['1'.repeat(32), '2'.repeat(32)]);
  });

  it('shows the configured defaults and every known destination', async () => {
    render(ProbeView);

    expect(screen.getByRole('spinbutton', { name: /^Timeout \(seconds\)/ })).toHaveValue(20);
    expect(screen.getByRole('spinbutton', { name: /^Probe size \(bytes\)/ })).toHaveValue(8);
    expect(screen.getByLabelText('Full destination name')).toHaveValue('lxmf.delivery');

    await fireEvent.click(screen.getByRole('button', { name: 'Show known destinations' }));
    const list = screen.getByRole('listbox', { name: 'Known Reticulum destinations' });
    expect(within(list).getByText('1'.repeat(32))).toBeInTheDocument();
    expect(within(list).getByText('2'.repeat(32))).toBeInTheDocument();
  });

  it('uses the shared probe API and places newest results first', async () => {
    const destination = 'a'.repeat(32);
    const probe = vi.spyOn(reticulumRuntime, 'probeDestination')
      .mockResolvedValueOnce({
        ok: true,
        destinationHash: destination,
        fullDestinationName: 'lxmf.delivery',
        probeSizeBytes: 8,
        roundTripTimeMs: 23.5,
        hops: 2,
        viaHash: 'b'.repeat(32),
        interfaceName: 'Community Hub',
        interfaceType: 'websocket',
      })
      .mockResolvedValueOnce({
        ok: false,
        destinationHash: destination,
        fullDestinationName: 'rnstransport.probe',
        probeSizeBytes: 8,
        code: 'PROBE_TIMEOUT',
      });
    render(ProbeView);

    await fireEvent.input(screen.getByLabelText('Destination hash'), { target: { value: destination } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send probe' }));
    expect(probe).toHaveBeenLastCalledWith(destination, 'lxmf.delivery', 20_000, 8, expect.any(AbortSignal));
    expect(screen.getByText('Valid proof received')).toBeInTheDocument();
    expect(screen.getByText('23.50 ms')).toBeInTheDocument();
    expect(screen.getByText(`via <${'b'.repeat(32)}> on Community Hub (WebSocket)`)).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Show destination names' }));
    await fireEvent.click(screen.getByRole('option', { name: 'rnstransport.probe' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Send probe' }));

    const results = screen.getByRole('list', { name: 'Probe results, newest first' });
    expect(within(results).getAllByRole('listitem')[0]).toHaveTextContent('Probe failed');
    expect(within(results).getAllByRole('listitem')[1]).toHaveTextContent('Valid proof received');
    expect(within(results).getByText('Error code: PROBE_TIMEOUT')).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Clear history' }));
    expect(screen.getByRole('heading', { name: 'No probe results yet' })).toBeInTheDocument();
  });

  it('drops the selected destination path', async () => {
    const destination = 'b'.repeat(32);
    const dropDestinationPath = vi.spyOn(reticulumRuntime, 'dropDestinationPath').mockResolvedValue(true);
    render(ProbeView);

    await fireEvent.input(screen.getByLabelText('Destination hash'), { target: { value: destination } });
    await fireEvent.click(screen.getByRole('button', { name: 'Drop path' }));

    expect(dropDestinationPath).toHaveBeenCalledWith(destination);
    expect(screen.getByRole('status')).toHaveTextContent('The cached path was dropped.');
  });

  it('shows cancellable pending entries and only blocks their destinations', async () => {
    const firstDestination = 'c'.repeat(32);
    const secondDestination = 'd'.repeat(32);
    vi.spyOn(reticulumRuntime, 'probeDestination').mockImplementation((
      destination,
      fullDestinationName,
      _timeoutMs,
      probeSizeBytes,
      signal,
    ) => new Promise((resolve) => {
      signal?.addEventListener('abort', () => resolve({
        ok: false,
        destinationHash: destination,
        fullDestinationName,
        probeSizeBytes,
        code: 'PROBE_CANCELLED',
      }), { once: true });
    }));
    render(ProbeView);
    render(ToastViewport);

    const destinationInput = screen.getByLabelText('Destination hash');
    await fireEvent.input(destinationInput, { target: { value: firstDestination } });
    await fireEvent.click(screen.getByRole('button', { name: 'Send probe' }));

    const history = screen.getByRole('list', { name: 'Probe results, newest first' });
    expect(within(history).getByText('Waiting for response…')).toBeInTheDocument();
    expect(within(history).getByRole('listitem').querySelector('time')).toBeNull();
    expect(screen.getByText(`Probe sent to <${'c'.repeat(8)}…${'c'.repeat(6)}>. Waiting for a response…`)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Waiting for response…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Drop path' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel probe' })).toBeInTheDocument();

    await fireEvent.input(destinationInput, { target: { value: secondDestination } });
    expect(screen.getByRole('button', { name: 'Send probe' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Drop path' })).toBeEnabled();
    await fireEvent.click(screen.getByRole('button', { name: 'Send probe' }));
    expect(within(history).getAllByText('Waiting for response…')).toHaveLength(2);

    for (const cancelButton of screen.getAllByRole('button', { name: 'Cancel probe' })) {
      await fireEvent.click(cancelButton);
    }
    await waitFor(() => expect(screen.getAllByText('Probe failed')).toHaveLength(2));
    expect(screen.getAllByText('Error code: PROBE_CANCELLED')).toHaveLength(2);
  });

  it('returns to the tools directory', async () => {
    render(ProbeView);

    await fireEvent.click(screen.getByRole('button', { name: 'Back to Tools' }));
    expect(window.location.hash).toBe('#/tools');
  });
});
