import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  chatAnnounces,
  chatContacts,
  knownDestinations,
  nomadAnnounces,
  pathTableEntries,
  propagationNodeAnnounces,
  provisioningNodes,
  reticulumRuntime,
  runtimeStatus,
  statusDetails,
} from '../../infrastructure/reticulum/runtime';
import { clearToasts } from '../../lib/notifications/toasts';
import ToastViewport from '../../lib/components/ToastViewport.svelte';
import PathManagementView from './PathManagementView.svelte';

describe('PathManagementView', () => {
  const pathDestination = '1'.repeat(32);
  const knownDestination = '2'.repeat(32);

  beforeEach(() => {
    vi.restoreAllMocks();
    clearToasts();
    runtimeStatus.set('online');
    chatAnnounces.set([]);
    chatContacts.set([]);
    nomadAnnounces.set([]);
    propagationNodeAnnounces.set([]);
    provisioningNodes.set([]);
    pathTableEntries.set([{
      destinationHash: pathDestination,
      hops: 2,
      nextHop: '3'.repeat(32),
      interfaceId: 'interface-1',
      expiresAt: '2026-07-24T10:00:00.000Z',
      lastAnnouncedAt: '2026-07-17T10:00:00.000Z',
    }]);
    knownDestinations.set([{
      destinationHash: knownDestination,
      publicKey: '4'.repeat(128),
      lastAnnouncedAt: '2026-07-23T10:00:00.000Z',
    }]);
    statusDetails.set({
      network: {
        activeLinks: 0,
        transportEnabled: false,
        transportedPackets: 0,
      },
      interfaces: [{
        id: 'interface-1',
        name: 'Community Hub',
        type: 'websocket',
        mode: 'full',
        state: 'online',
        rxRateBps: 0,
        txRateBps: 0,
        rxBytes: 0,
        txBytes: 0,
        rxPackets: 0,
        txPackets: 0,
        incomingAnnounces: 0,
        outgoingAnnounces: 0,
        incomingAnnouncesPerSecond: 0,
        outgoingAnnouncesPerSecond: 0,
      }, {
        id: 'interface-2',
        name: 'Radio Link',
        type: 'rnode',
        mode: 'full',
        state: 'online',
        rxRateBps: 0,
        txRateBps: 0,
        rxBytes: 0,
        txBytes: 0,
        rxPackets: 0,
        txPackets: 0,
        incomingAnnounces: 0,
        outgoingAnnounces: 0,
        incomingAnnouncesPerSecond: 0,
        outgoingAnnouncesPerSecond: 0,
      }],
    });
  });

  it('filters paths by partial destination hash, interface, and hop count', async () => {
    const otherDestination = 'a'.repeat(32);
    pathTableEntries.set([
      {
        destinationHash: pathDestination,
        hops: 2,
        nextHop: '3'.repeat(32),
        interfaceId: 'interface-1',
        expiresAt: '2026-07-24T10:00:00.000Z',
        lastAnnouncedAt: '2026-07-17T10:00:00.000Z',
      },
      {
        destinationHash: otherDestination,
        hops: 3,
        nextHop: 'b'.repeat(32),
        interfaceId: 'interface-2',
        expiresAt: '2026-07-25T10:00:00.000Z',
        lastAnnouncedAt: '2026-07-18T10:00:00.000Z',
      },
    ]);
    render(PathManagementView);

    const filterToggle = screen.getByRole('button', { name: 'Show filters' });
    expect(filterToggle).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.click(filterToggle);
    expect(filterToggle).toHaveAttribute('aria-expanded', 'true');
    expect(filterToggle).toHaveAccessibleName('Hide filters');
    expect(document.getElementById('path-management-filters')).toHaveClass('expanded');

    const destinationSearch = screen.getByLabelText('Filter by destination hash');
    expect(destinationSearch.closest('.path-management-search')?.querySelector('svg')).toBeInTheDocument();
    await fireEvent.input(destinationSearch, { target: { value: 'aaaa' } });
    expect(screen.queryByText(pathDestination)).not.toBeInTheDocument();
    expect(screen.getByText(otherDestination)).toBeInTheDocument();
    await fireEvent.click(filterToggle);
    expect(filterToggle).toHaveAccessibleName('Show filters (1)');
    await fireEvent.click(filterToggle);

    await fireEvent.input(destinationSearch, { target: { value: '' } });
    expect(screen.getByRole('option', { name: 'Radio Link' })).toBeInTheDocument();
    await fireEvent.change(screen.getByLabelText('Filter by interface'), {
      target: { value: 'interface-1' },
    });
    expect(screen.getByText(pathDestination)).toBeInTheDocument();
    expect(screen.queryByText(otherDestination)).not.toBeInTheDocument();

    await fireEvent.change(screen.getByLabelText('Filter by interface'), { target: { value: '' } });
    await fireEvent.input(screen.getByLabelText('Filter by hop count'), { target: { value: '3' } });
    expect(screen.queryByText(pathDestination)).not.toBeInTheDocument();
    expect(screen.getByText(otherDestination)).toBeInTheDocument();

    await fireEvent.input(screen.getByLabelText('Filter by hop count'), { target: { value: '' } });
    expect(screen.getByText(pathDestination)).toBeInTheDocument();
    expect(screen.getByText(otherDestination)).toBeInTheDocument();

    await fireEvent.input(destinationSearch, { target: { value: 'aaaa' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(destinationSearch).toHaveValue('');
    expect(screen.getByLabelText('Filter by interface')).toHaveValue('');
    expect(screen.getByLabelText('Filter by hop count')).toHaveValue(null);
    expect(screen.getByText(pathDestination)).toBeInTheDocument();
    expect(screen.getByText(otherDestination)).toBeInTheDocument();
  });

  it('offers to scroll the complete view back to the top', async () => {
    const main = document.createElement('main');
    const scrollTo = vi.fn((options?: ScrollToOptions) => {
      if (typeof options?.top === 'number') main.scrollTop = options.top;
    });
    Object.defineProperty(main, 'scrollTo', { configurable: true, value: scrollTo });
    document.body.append(main);
    render(PathManagementView, { target: main });
    scrollTo.mockClear();

    main.scrollTop = 120;
    await fireEvent.scroll(main);
    const scrollButton = await screen.findByRole('button', { name: 'Scroll to top' });
    expect(scrollButton).toHaveClass('message-scroll-latest');
    await fireEvent.click(scrollButton);

    expect(scrollTo).toHaveBeenCalledWith({
      top: 0,
      left: 0,
      behavior: 'smooth',
    });
    expect(screen.queryByRole('button', { name: 'Scroll to top' })).not.toBeInTheDocument();
  });

  it('does not open a counterpart after pointer movement or text selection', async () => {
    knownDestinations.set([{
      destinationHash: pathDestination,
      publicKey: '4'.repeat(128),
      lastAnnouncedAt: '2026-07-23T10:00:00.000Z',
    }]);
    render(PathManagementView);

    const pathEntry = screen.getByText(pathDestination).closest('li');
    const entryCopy = pathEntry!.querySelector('.path-management-entry-copy')!;
    await fireEvent.pointerDown(entryCopy, {
      pointerId: 7,
      button: 0,
      clientX: 20,
      clientY: 20,
    });
    await fireEvent.pointerMove(entryCopy, {
      pointerId: 7,
      buttons: 1,
      clientX: 34,
      clientY: 20,
    });
    expect(pathEntry).toHaveClass('entry-pointer-moved');
    await fireEvent.pointerUp(entryCopy, {
      pointerId: 7,
      button: 0,
      clientX: 34,
      clientY: 20,
    });
    await fireEvent.click(entryCopy);

    expect(screen.getByRole('tab', { name: /Paths/ })).toHaveAttribute('aria-selected', 'true');
    expect(pathEntry).not.toHaveClass('entry-pointer-moved');

    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(screen.getByText(pathDestination));
    selection.removeAllRanges();
    selection.addRange(range);
    await fireEvent.click(entryCopy);
    expect(screen.getByRole('tab', { name: /Paths/ })).toHaveAttribute('aria-selected', 'true');
    expect(pathEntry).toHaveClass('entry-text-selected');

    selection.removeAllRanges();
    await fireEvent.pointerMove(entryCopy, { pointerId: 7, buttons: 0 });
    expect(pathEntry).not.toHaveClass('entry-text-selected');
    await fireEvent.click(entryCopy);
    expect(screen.getByRole('tab', { name: /Known destinations/ }))
      .toHaveAttribute('aria-selected', 'true');
  });

  it('filters known destinations by partial hash and shows a no-results state', async () => {
    render(PathManagementView);

    await fireEvent.click(screen.getByRole('tab', { name: /Known destinations/ }));
    expect(screen.queryByLabelText('Filter by interface')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Filter by hop count')).not.toBeInTheDocument();

    const destinationSearch = screen.getByLabelText('Filter by destination hash');
    await fireEvent.input(destinationSearch, { target: { value: '2222' } });
    expect(screen.getByText(knownDestination)).toBeInTheDocument();

    await fireEvent.input(destinationSearch, { target: { value: 'ffff' } });
    expect(screen.queryByText(knownDestination)).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'No matching destinations' })).toBeInTheDocument();
  });

  it('filters known destinations by destination type and clears the filter', async () => {
    const lxmfDestination = 'a'.repeat(32);
    knownDestinations.set([
      {
        destinationHash: knownDestination,
        publicKey: '4'.repeat(128),
        lastAnnouncedAt: '2026-07-23T10:00:00.000Z',
      },
      {
        destinationHash: lxmfDestination,
        publicKey: '5'.repeat(128),
        lastAnnouncedAt: '2026-07-22T10:00:00.000Z',
      },
    ]);
    chatAnnounces.set([{
      id: `identity-1:${lxmfDestination}`,
      identityId: 'identity-1',
      destinationHash: lxmfDestination,
      identityHash: '9'.repeat(32),
      publicKey: '5'.repeat(128),
      displayName: 'Alice',
      heardAt: '2026-07-22T10:00:00.000Z',
    }]);
    render(PathManagementView);

    await fireEvent.click(screen.getByRole('tab', { name: /Known destinations/ }));
    const typeFilter = screen.getByLabelText('Filter by destination type');
    expect(typeFilter).toHaveValue('');

    await fireEvent.change(typeFilter, { target: { value: 'lxmfDelivery' } });
    expect(screen.getByText(lxmfDestination)).toBeInTheDocument();
    expect(screen.queryByText(knownDestination)).not.toBeInTheDocument();

    await fireEvent.change(typeFilter, { target: { value: 'unknown' } });
    expect(screen.getByText(knownDestination)).toBeInTheDocument();
    expect(screen.queryByText(lxmfDestination)).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(typeFilter).toHaveValue('');
    expect(screen.getByText(knownDestination)).toBeInTheDocument();
    expect(screen.getByText(lxmfDestination)).toBeInTheDocument();
  });

  it('requests a manually entered destination and can request a listed path again', async () => {
    let resolveRequest!: (result: Awaited<ReturnType<typeof reticulumRuntime.requestDestinationPath>>) => void;
    const request = vi.spyOn(reticulumRuntime, 'requestDestinationPath').mockImplementation(() => (
      new Promise((resolve) => { resolveRequest = resolve; })
    ));
    render(PathManagementView);
    render(ToastViewport);

    const pathEntry = screen.getByText(pathDestination).closest('li');
    const pathActions = pathEntry!.querySelector('.path-management-entry-actions');
    await fireEvent.pointerEnter(pathActions!);
    expect(pathEntry).toHaveClass('entry-actions-hovered');
    await fireEvent.pointerLeave(pathActions!);
    expect(pathEntry).not.toHaveClass('entry-actions-hovered');

    const manualDestination = 'a'.repeat(32);
    await fireEvent.input(screen.getByLabelText('Destination hash'), {
      target: { value: manualDestination },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Request path' }));

    expect(request).toHaveBeenCalledWith(manualDestination, expect.any(AbortSignal));
    expect(screen.getByRole('status')).toHaveTextContent('Looking for a path to <aaaaaaaa…aaaaaa>');
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    resolveRequest({ ok: true, destinationHash: manualDestination, hops: 2 });
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'A path to <aaaaaaaa…aaaaaa> was found with 2 hops.',
      );
    });
    expect(screen.getByText(`via <${'3'.repeat(32)}> on Community Hub (WebSocket)`)).toBeInTheDocument();
    expect(screen.getByText('2 hops')).toHaveClass('path-management-entry-badge', 'hop-count');
    expect(screen.getByText('Expires')).toBeInTheDocument();
    expect(screen.getByText('Last announce')).toBeInTheDocument();
    expect(Array.from(screen.getByText(pathDestination).closest('li')!.querySelectorAll('dt'))
      .map((label) => label.textContent)).toEqual(['Last announce', 'Expires']);
    expect(document.querySelector('time[datetime="2026-07-24T10:00:00.000Z"]')).toBeInTheDocument();
    expect(document.querySelector('time[datetime="2026-07-17T10:00:00.000Z"]')).toBeInTheDocument();

    request.mockResolvedValueOnce({ ok: true, destinationHash: pathDestination, hops: 2 });
    await fireEvent.click(screen.getByRole('button', { name: 'Request new path' }));
    expect(request).toHaveBeenLastCalledWith(pathDestination, expect.any(AbortSignal));
  });

  it('finishes a live path activity with an error when discovery times out', async () => {
    vi.spyOn(reticulumRuntime, 'requestDestinationPath').mockResolvedValue({
      ok: false,
      destinationHash: pathDestination,
      code: 'PATH_REQUEST_TIMEOUT',
    });
    render(PathManagementView);
    render(ToastViewport);

    expect(screen.queryByText('Enter a valid 32-character hexadecimal destination hash.')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Request new path' }));

    expect(screen.queryByText('Enter a valid 32-character hexadecimal destination hash.')).not.toBeInTheDocument();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'No path to <11111111…111111> was found before the request timed out.',
    );
  });

  it('aborts the worker request when the live activity is cancelled', async () => {
    let observedSignal: AbortSignal | undefined;
    const request = vi.spyOn(reticulumRuntime, 'requestDestinationPath').mockImplementation((
      destinationHash,
      signal,
    ) => new Promise((resolve) => {
      observedSignal = signal;
      signal?.addEventListener('abort', () => resolve({
        ok: false,
        destinationHash,
        code: 'PATH_REQUEST_CANCELLED',
      }), { once: true });
    }));
    render(PathManagementView);
    render(ToastViewport);

    await fireEvent.click(screen.getByRole('button', { name: 'Request new path' }));
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel activity' }));

    expect(request).toHaveBeenCalledWith(pathDestination, expect.any(AbortSignal));
    expect(observedSignal?.aborted).toBe(true);
    await waitFor(() => {
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Request new path' })).toBeEnabled();
    });
  });

  it('deletes one path and clears the complete path list after confirmation', async () => {
    const drop = vi.spyOn(reticulumRuntime, 'dropDestinationPath').mockResolvedValue(true);
    const clear = vi.spyOn(reticulumRuntime, 'clearDestinationPaths').mockResolvedValue(true);
    render(PathManagementView);

    await fireEvent.click(screen.getByRole('button', { name: 'Drop path' }));
    expect(drop).toHaveBeenCalledWith(pathDestination);

    await fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByRole('heading', { name: 'Clear all cached paths?' })).toBeInTheDocument();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Clear paths' }));
    expect(clear).toHaveBeenCalledOnce();
  });

  it('shows received identity details and forgets the destination after confirmation', async () => {
    const forget = vi.spyOn(reticulumRuntime, 'forgetKnownDestination').mockResolvedValue(true);
    render(PathManagementView);

    await fireEvent.click(screen.getByRole('tab', { name: /Known destinations/ }));
    expect(screen.getByText(knownDestination)).toBeInTheDocument();
    expect(screen.getByText('4'.repeat(128))).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Forget destination' }));
    const dialog = screen.getByRole('alertdialog');
    expect(within(dialog).getByText(/remembered public identity/)).toBeInTheDocument();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Forget destination' }));

    expect(forget).toHaveBeenCalledWith(knownDestination);
  });

  it('shows application metadata, names, capabilities, and reachability for known destinations', async () => {
    const propagationDestination = '5'.repeat(32);
    const nomadDestination = '6'.repeat(32);
    const managementDestination = '7'.repeat(32);
    const unknownDestination = '8'.repeat(32);
    const unmatchedPathDestination = 'a'.repeat(32);
    knownDestinations.set([
      knownDestination,
      propagationDestination,
      nomadDestination,
      managementDestination,
      unknownDestination,
    ].map((destinationHash, index) => ({
      destinationHash,
      publicKey: String(index + 4).repeat(128),
      lastAnnouncedAt: '2026-07-23T10:00:00.000Z',
    })));
    pathTableEntries.set([
      {
        destinationHash: knownDestination,
        hops: 2,
        nextHop: '3'.repeat(32),
        interfaceId: 'interface-1',
        expiresAt: '2026-07-24T10:00:00.000Z',
        lastAnnouncedAt: '2026-07-23T10:00:00.000Z',
      },
      {
        destinationHash: unmatchedPathDestination,
        hops: 3,
        lastAnnouncedAt: '2026-07-22T10:00:00.000Z',
      },
    ]);
    chatAnnounces.set([{
      id: `identity-1:${knownDestination}`,
      identityId: 'identity-1',
      destinationHash: knownDestination,
      identityHash: '9'.repeat(32),
      publicKey: '4'.repeat(128),
      displayName: 'Shared Alice',
      stampCost: 8,
      compressionSupported: true,
      heardAt: '2026-07-23T10:00:00.000Z',
    }]);
    chatContacts.set([{
      id: `identity-1:${knownDestination}`,
      identityId: 'identity-1',
      destinationHash: knownDestination,
      name: 'Local Alice',
      createdAt: '2026-07-23T10:00:00.000Z',
      updatedAt: '2026-07-23T10:00:00.000Z',
    }]);
    propagationNodeAnnounces.set([{
      destinationHash: propagationDestination,
      enabled: true,
      transferLimitKb: 1_000,
      syncLimitKb: 2_000,
      stampCost: 3,
      peeringCost: 4,
      heardAt: '2026-07-23T10:00:00.000Z',
    }]);
    nomadAnnounces.set([{
      id: nomadDestination,
      destinationHash: nomadDestination,
      displayName: 'Forest Node',
      heardAt: '2026-07-23T10:00:00.000Z',
    }]);
    provisioningNodes.set([{
      id: managementDestination,
      destinationHash: managementDestination,
      publicKey: '7'.repeat(128),
      heardAt: '2026-07-23T10:00:00.000Z',
    }]);
    render(PathManagementView);

    await fireEvent.click(screen.getByRole('tab', { name: /Known destinations/ }));
    expect(screen.getByText('Local Alice')).toBeInTheDocument();
    expect(screen.getByText('Local contact')).toBeInTheDocument();
    expect(screen.getByText('Announced as Shared Alice')).toBeInTheDocument();
    expect(screen.getByText('Forest Node')).toBeInTheDocument();
    expect(Array.from(document.querySelectorAll('.path-management-entry-badge.destination-type'))
      .map((badge) => badge.textContent?.trim())).toEqual(expect.arrayContaining([
        'LXMF delivery',
        'LXMF propagation',
        'NomadNet',
        'Management',
        'Unknown',
      ]));
    expect(screen.getByText('Supported')).toBeInTheDocument();
    expect(screen.getByText('1,000 KB')).toBeInTheDocument();
    expect(screen.getByText('2,000 KB')).toBeInTheDocument();
    expect(screen.getByText(knownDestination).closest('li')?.querySelector('.hop-count'))
      .toHaveTextContent('2 hops');
    expect(screen.queryByText(/Path available/)).not.toBeInTheDocument();
    expect(screen.getAllByText('No path')).toHaveLength(4);

    const knownDestinationEntry = screen.getByText(knownDestination).closest('li');
    expect(knownDestinationEntry).toHaveClass('counterpart-available');
    expect(knownDestinationEntry?.querySelector('.known-destination-public-key'))
      .toBeInTheDocument();
    expect(knownDestinationEntry?.querySelector('.known-destination-metrics'))
      .toBeInTheDocument();
    await fireEvent.click(knownDestinationEntry!.querySelector('.path-management-entry-copy')!);
    expect(screen.getByRole('tab', { name: /Paths/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByLabelText('Filter by destination hash')).toHaveValue('');
    const pathCounterpart = screen.getByText(knownDestination).closest('li');
    expect(pathCounterpart).toHaveClass('counterpart-highlight');
    expect(pathCounterpart).toHaveClass('counterpart-hover-suppressed');
    expect(within(pathCounterpart!).getByText('Local Alice')).toBeInTheDocument();
    expect(within(pathCounterpart!).getByText('Announced as Shared Alice')).toBeInTheDocument();
    expect(within(pathCounterpart!).getByText('LXMF delivery')).toHaveClass('destination-type');
    expect(pathCounterpart!.querySelector('.hop-count')).toHaveTextContent('2 hops');
    const otherPathEntry = screen.getByText(unmatchedPathDestination).closest('li');
    expect(otherPathEntry).toHaveClass('counterpart-hover-suppressed');
    expect(otherPathEntry).not.toHaveClass('counterpart-highlight');
    await fireEvent.pointerLeave(otherPathEntry!);
    expect(otherPathEntry).toHaveClass('counterpart-hover-suppressed');

    await fireEvent.click(pathCounterpart!.querySelector('.path-management-entry-copy')!);
    expect(screen.getByRole('tab', { name: /Known destinations/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(knownDestination).closest('li')).toHaveClass('counterpart-highlight');
    const otherDestinationEntry = screen.getByText(unknownDestination).closest('li');
    expect(otherDestinationEntry).toHaveClass('counterpart-hover-suppressed');
    expect(otherDestinationEntry).not.toHaveClass('counterpart-highlight');
  });

  it('scrolls a counterpart entry into view after switching tabs', async () => {
    const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'scrollIntoView',
    );
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    pathTableEntries.set([{
      destinationHash: knownDestination,
      hops: 1,
      lastAnnouncedAt: '2026-07-23T10:00:00.000Z',
    }]);

    try {
      render(PathManagementView);
      await fireEvent.click(screen.getByRole('tab', { name: /Known destinations/ }));
      await fireEvent.click(screen.getByText(knownDestination).closest('.path-management-entry-copy')!);

      await waitFor(() => {
        expect(scrollIntoView).toHaveBeenCalledWith({
          behavior: 'smooth',
          block: 'center',
        });
      });
      expect(screen.getByText(knownDestination).closest('li')).toHaveClass('counterpart-highlight');
    } finally {
      if (scrollIntoViewDescriptor) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', scrollIntoViewDescriptor);
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
      }
    }
  });

  it('copies path and destination hashes from the shared context-menu action', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    try {
      render(PathManagementView);
      const pathEntry = screen.getByText(pathDestination).closest('li');
      await fireEvent.contextMenu(pathEntry!, { clientX: 100, clientY: 100 });
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy destination hash' }));
      expect(writeText).toHaveBeenLastCalledWith(pathDestination);

      await fireEvent.click(screen.getByRole('tab', { name: /Known destinations/ }));
      const destinationEntry = screen.getByText(knownDestination).closest('li');
      await fireEvent.contextMenu(destinationEntry!, { clientX: 120, clientY: 120 });
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy destination hash' }));
      expect(writeText).toHaveBeenLastCalledWith(knownDestination);
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('sorts by last announce, groups shared identities, and separates local destinations', async () => {
    const sharedPublicKey = 'a'.repeat(128);
    const newestDestination = '5'.repeat(32);
    const groupedDestination = '6'.repeat(32);
    const localPropagationDestination = 'e'.repeat(32);
    const localDestination = 'f'.repeat(32);
    knownDestinations.set([
      {
        destinationHash: knownDestination,
        publicKey: sharedPublicKey,
        lastAnnouncedAt: '2026-07-21T10:00:00.000Z',
      },
      {
        destinationHash: newestDestination,
        publicKey: 'b'.repeat(128),
        lastAnnouncedAt: '2026-07-23T10:00:00.000Z',
      },
      {
        destinationHash: groupedDestination,
        publicKey: sharedPublicKey,
        lastAnnouncedAt: '2026-07-22T10:00:00.000Z',
      },
      {
        destinationHash: localPropagationDestination,
        isLocal: true,
        lastAnnouncedAt: '2026-07-23T12:00:00.000Z',
      },
      {
        destinationHash: localDestination,
        isLocal: true,
        fullDestinationName: 'lxmf.delivery',
        lastAnnouncedAt: '2026-07-24T10:00:00.000Z',
      },
    ]);
    pathTableEntries.set([
      {
        destinationHash: pathDestination,
        hops: 2,
        lastAnnouncedAt: '2026-07-21T10:00:00.000Z',
      },
      {
        destinationHash: newestDestination,
        hops: 1,
        lastAnnouncedAt: '2026-07-23T10:00:00.000Z',
      },
    ]);
    render(PathManagementView);

    const pathList = screen.getByRole('list', { name: 'Known Reticulum paths' });
    expect(Array.from(pathList.querySelectorAll('.path-management-hash')).map((item) => item.textContent))
      .toEqual([newestDestination, pathDestination]);

    await fireEvent.click(screen.getByRole('tab', { name: /Known destinations/ }));
    const destinationList = screen.getByRole('list', {
      name: 'Known Reticulum destinations and received announces',
    });
    expect(Array.from(destinationList.querySelectorAll(':scope > li:not(.known-destination-section-heading) .path-management-hash'))
      .map((item) => item.textContent)).toEqual([
        newestDestination,
        groupedDestination,
        knownDestination,
        localDestination,
        localPropagationDestination,
      ]);

    await fireEvent.click(screen.getByLabelText('Group by identity'));
    const identityGroupHeading = screen.getByText('Shared identity (2)').closest('li');
    expect(identityGroupHeading).toHaveClass('known-destination-section-heading', 'identity-group');
    expect(identityGroupHeading?.querySelector('code')).toHaveTextContent('aaaaaaaaaaaa…aaaaaaaa');
    expect(screen.getByText('Local destinations')).toBeInTheDocument();
    expect(screen.getByText(groupedDestination).closest('li'))
      .toHaveClass('identity-group-entry', 'identity-group-entry-first');
    expect(screen.getByText(knownDestination).closest('li'))
      .toHaveClass('identity-group-entry', 'identity-group-entry-last');
    const localEntry = screen.getByText(localDestination).closest('li');
    expect(within(localEntry!).getByText('LXMF delivery')).toBeInTheDocument();
    expect(within(localEntry!).queryByText('No path')).not.toBeInTheDocument();
    expect(localEntry!.querySelector('.hop-count')).not.toBeInTheDocument();
    expect(localEntry!.querySelector('.path-unavailable')).not.toBeInTheDocument();
    expect(within(localEntry!).queryByText('Full destination name')).not.toBeInTheDocument();
    expect(within(localEntry!).queryByText('lxmf.delivery')).not.toBeInTheDocument();
    expect(within(localEntry!).queryByText('Public key')).not.toBeInTheDocument();
    expect(within(localEntry!).queryByRole('button', { name: 'Forget destination' })).not.toBeInTheDocument();
    const localPropagationEntry = screen.getByText(localPropagationDestination).closest('li');
    expect(within(localPropagationEntry!).getAllByText('Unknown')).toHaveLength(1);
    expect(localPropagationEntry!.querySelector('.hop-count')).not.toBeInTheDocument();
    expect(localPropagationEntry!.querySelector('.path-unavailable')).not.toBeInTheDocument();
  });
});
