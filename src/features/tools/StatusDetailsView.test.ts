import { fireEvent, render, screen, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reticulumRuntime, statusDetails } from '../../infrastructure/reticulum/runtime';
import StatusDetailsView from './StatusDetailsView.svelte';

describe('StatusDetailsView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    statusDetails.set({
      network: {
        activeLinks: 2,
        transportEnabled: true,
        transportHashHex: 'ab'.repeat(16),
        transportedPackets: 17,
      },
      interfaces: [
        {
          id: 'websocket',
          name: 'Home relay',
          type: 'websocket',
          mode: 'full',
          state: 'online',
          bitrateBps: 10_550_000,
          rxRateBps: 4_200,
          txRateBps: 2_100,
          rxBytes: 10_550,
          txBytes: 15_100,
          rxPackets: 4,
          txPackets: 5,
          incomingAnnounces: 8,
          outgoingAnnounces: 3,
          incomingAnnouncesPerSecond: 0,
          outgoingAnnouncesPerSecond: 0.0061,
        },
        {
          id: 'rnode',
          name: 'RNode 2',
          type: 'rnode',
          mode: 'accessPoint',
          rnodeConnectionType: 'ble',
          state: 'online',
          bitrateBps: 3_120,
          rxRateBps: 800,
          txRateBps: 400,
          rxBytes: 9_590,
          txBytes: 4_300,
          rxPackets: 2,
          txPackets: 3,
          incomingAnnounces: 12,
          outgoingAnnounces: 7,
          incomingAnnouncesPerSecond: 0.00849,
          outgoingAnnouncesPerSecond: 0.00405,
          rnode: {
            radioRxPackets: 12,
            radioTxPackets: 9,
            noiseFloorDbm: -92,
            batteryState: 'charging',
            batteryPercent: 84,
            airtimeShortPercent: 0,
            airtimeLongPercent: 0.55,
            channelLoadShortPercent: 0,
            channelLoadLongPercent: 1.82,
          },
        },
      ],
    });
  });

  it('shows network and enabled-interface status details', () => {
    render(StatusDetailsView);

    expect(screen.getByText('2', { selector: '.active-link-count' })).toBeInTheDocument();
    expect(screen.getByText('abababababababababababababababab')).toBeInTheDocument();
    expect(screen.getByText('17')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Home relay' })).toBeInTheDocument();
    const websocketCard = screen.getByRole('heading', { name: 'Home relay' }).closest('article');
    expect(websocketCard).not.toBeNull();
    expect(within(websocketCard!).getByText('Max bitrate')).toBeInTheDocument();
    expect(within(websocketCard!).getByText('Current RX')).toBeInTheDocument();
    expect(within(websocketCard!).getByText('4.20 kbps')).toBeInTheDocument();
    expect(within(websocketCard!).getByText('Current TX')).toBeInTheDocument();
    expect(within(websocketCard!).getByText('2.10 kbps')).toBeInTheDocument();
    const metricLabels = Array.from(websocketCard!.querySelectorAll('dt'), (label) => label.textContent);
    expect(metricLabels.indexOf('Incoming announces'))
      .toBeLessThan(metricLabels.indexOf('Incoming announces / second'));
    expect(metricLabels.indexOf('Outgoing announces'))
      .toBeLessThan(metricLabels.indexOf('Outgoing announces / second'));
    const rnodeHeading = screen.getByRole('heading', { name: 'RNode 2' });
    expect(rnodeHeading).toBeInTheDocument();
    expect(rnodeHeading.parentElement?.querySelector('.status-interface-type'))
      .toHaveTextContent(/RNode\s*·\s*Bluetooth LE/);
    expect(screen.getByText('84% (charging)')).toBeInTheDocument();
    expect(screen.getByText('0% (15s), 0.55% (1h)')).toBeInTheDocument();
    const radioDetails = screen.getByRole('region', { name: 'LoRa radio' });
    expect(within(radioDetails).getByText('Radio RX packets')).toBeInTheDocument();
    expect(within(radioDetails).getByText('12')).toBeInTheDocument();
    expect(within(radioDetails).queryByText('2')).not.toBeInTheDocument();
  });

  it('closes every active link through the runtime', async () => {
    const closeAllLinks = vi.spyOn(reticulumRuntime, 'closeAllLinks').mockImplementation(() => undefined);
    render(StatusDetailsView);

    await fireEvent.click(screen.getByRole('button', { name: 'Close all links' }));
    expect(closeAllLinks).toHaveBeenCalledOnce();
  });

  it('expands and collapses mobile metrics independently for each interface', async () => {
    render(StatusDetailsView);

    const websocketCard = screen.getByRole('heading', { name: 'Home relay' }).closest('article')!;
    const rnodeCard = screen.getByRole('heading', { name: 'RNode 2' }).closest('article')!;
    const websocketToggle = websocketCard.querySelector<HTMLButtonElement>('.status-metrics-toggle')!;
    const rnodeToggle = rnodeCard.querySelector<HTMLButtonElement>('.status-metrics-toggle')!;

    expect(websocketToggle).toHaveTextContent('Show more');
    expect(websocketToggle).toHaveAttribute('aria-expanded', 'false');
    expect(websocketToggle).toHaveAttribute('aria-controls', 'status-interface-metrics-websocket');
    expect(rnodeToggle).toHaveAttribute('aria-expanded', 'false');

    await fireEvent.click(websocketToggle);

    expect(websocketCard).toHaveClass('metrics-expanded');
    expect(websocketToggle).toHaveTextContent('Show less');
    expect(websocketToggle).toHaveAttribute('aria-expanded', 'true');
    expect(rnodeCard).not.toHaveClass('metrics-expanded');
    expect(rnodeToggle).toHaveAttribute('aria-expanded', 'false');

    await fireEvent.click(websocketToggle);
    expect(websocketCard).not.toHaveClass('metrics-expanded');
    expect(websocketToggle).toHaveTextContent('Show more');
  });

  it('shows an empty state when no interfaces are enabled', () => {
    statusDetails.set({
      network: { activeLinks: 0, transportEnabled: false, transportedPackets: 0 },
      interfaces: [],
    });
    render(StatusDetailsView);

    expect(screen.getByRole('heading', { name: 'No enabled interfaces' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close all links' })).toBeDisabled();
  });
});
