import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InterfaceConfig } from '../../domain/settings';
import { BrowserSettingsRepository } from '../../infrastructure/database/settings-repository';
import {
  activeIdentity,
  chatContacts,
  destinationPathStatuses,
  interfaceConfigurations,
  interfaceStatuses,
  knownDestinations,
  pathTableReady,
  pathTableEntries,
  remoteDestinationInventory,
  reticulumRuntime,
  runtimeStatus,
} from '../../infrastructure/reticulum/runtime';
import { clearProbeHistory } from '../../infrastructure/reticulum/probe-history';
import { clearDestinationPathRequestCooldowns } from '../../infrastructure/reticulum/path-request-operations';
import { clearToasts } from '../../lib/notifications/toasts';
import NetworkVisualizerView from './NetworkVisualizerView.svelte';
import { resetNetworkVisualizerRuntimeSettings } from './network-visualizer-runtime-settings';

const destinationHash = 'a'.repeat(32);
const nextHopHash = 'b'.repeat(32);
const websocket: InterfaceConfig = {
  id: 'websocket-1',
  schemaVersion: 5,
  createdAt: '2026-08-20T00:00:00.000Z',
  name: 'Community hub',
  enabled: true,
  type: 'websocket',
  mode: 'full',
  reannounceOnReconnect: false,
  ifac: { networkName: '', passphrase: '', credentialRevision: 'test' },
  connection: { scheme: 'wss', host: 'example.test', path: '/' },
};

function pointerEvent(
  type: string,
  init: { button?: number; clientX: number; clientY: number; pointerId: number },
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  for (const [property, value] of Object.entries({ isPrimary: true, ...init })) {
    Object.defineProperty(event, property, { configurable: true, value });
  }
  return event;
}

describe('NetworkVisualizerView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: false,
      media: '',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    window.history.replaceState(null, '', '#/network-visualizer');
    clearProbeHistory();
    clearDestinationPathRequestCooldowns();
    clearToasts();
    resetNetworkVisualizerRuntimeSettings();
    activeIdentity.set({
      id: 'identity-1',
      displayName: 'Nora',
      identityHashHex: 'c'.repeat(32),
      publicKeyHex: 'd'.repeat(64),
    });
    interfaceConfigurations.set([websocket]);
    interfaceStatuses.set({ 'websocket-1': 'online' });
    runtimeStatus.set('online');
    destinationPathStatuses.set({});
    remoteDestinationInventory.set([]);
    pathTableReady.set(true);
    pathTableEntries.set([{
      destinationHash,
      nextHop: nextHopHash,
      interfaceId: 'websocket-1',
      hops: 3,
    }]);
    knownDestinations.set([{
      destinationHash,
      displayName: 'Field station',
      fullDestinationName: 'nomadnetwork.node',
    }]);
    chatContacts.set([]);
  });

  it('keeps a compact header and integrates controls into the full-height graph panel', () => {
    const { container } = render(NetworkVisualizerView);

    expect(screen.getByLabelText('Maximum hops')).toHaveAttribute('type', 'number');
    expect(screen.getByLabelText('Maximum hops')).toHaveValue(5);
    expect(screen.getByRole('checkbox', { name: 'Group by identity' })).not.toBeChecked();
    expect(screen.getByRole('heading', { name: 'Network visualizer' })).toBeInTheDocument();
    expect(screen.getByText(
      'Explore the routes currently known to this device without inferring unseen intermediate routers.',
    )).toBeInTheDocument();
    expect(screen.getByRole('application', {
      name: 'Interactive local Reticulum route graph with 1 routes across 1 interfaces.',
    })).toBeInTheDocument();
    expect(screen.getByText('Nora')).toBeInTheDocument();
    expect(screen.getByText('Community hub')).toBeInTheDocument();
    expect(screen.getByText(`${nextHopHash.slice(0, 8)}…${nextHopHash.slice(-6)}`)).toBeInTheDocument();
    expect(screen.getByLabelText('Network view controls').closest('.network-visualizer-panel'))
      .not.toBeNull();
    expect(screen.getByLabelText('Search network nodes').closest('.network-visualizer-panel')).not.toBeNull();
    expect(screen.getByLabelText('Visible network summary').closest('.network-visualizer-panel')).not.toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Selected network node details' })).not.toBeInTheDocument();
    expect(container.querySelector('.page-scroll-top')).not.toBeInTheDocument();
  });

  it('groups multiple destinations for one public identity on demand', async () => {
    const secondDestinationHash = 'e'.repeat(32);
    const publicKey = 'f'.repeat(128);
    const identityHash = '1'.repeat(32);
    pathTableEntries.set([
      { destinationHash, interfaceId: websocket.id, hops: 1 },
      { destinationHash: secondDestinationHash, interfaceId: websocket.id, hops: 1 },
    ]);
    remoteDestinationInventory.set([
      { destinationHash, publicKey, identityHash },
      { destinationHash: secondDestinationHash, publicKey, identityHash },
    ]);
    knownDestinations.set([
      { destinationHash, displayName: 'Field station', fullDestinationName: 'nomadnetwork.node' },
      { destinationHash: secondDestinationHash, displayName: 'Workshop', fullDestinationName: 'lxmf.delivery' },
    ]);
    const { container } = render(NetworkVisualizerView);

    expect(container.querySelector('.network-flow-node.identity')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Group by identity' }));

    await waitFor(() => expect(container.querySelectorAll('.network-flow-node.identity')).toHaveLength(1));
    expect(screen.getByText('Identity')).toBeInTheDocument();
    expect(screen.getByText('Transport node')).toBeInTheDocument();
    const identity = screen.getByRole('button', {
      name: `Identity: ${identityHash.slice(0, 8)}…${identityHash.slice(-6)}. 2 destinations, collapsed. Activate to toggle destinations; open the context menu for identity actions.`,
    });
    expect(identity).toHaveAttribute('aria-expanded', 'false');
    expect(identity).toHaveTextContent('2');
    expect(screen.queryByText('Field station')).not.toBeInTheDocument();
    expect(screen.queryByText('Workshop')).not.toBeInTheDocument();

    await fireEvent.click(identity);

    expect(await screen.findByText('Field station')).toBeInTheDocument();
    expect(screen.getByText('Workshop')).toBeInTheDocument();
    const expandedIdentity = screen.getByRole('button', { name: /2 destinations, expanded/ });
    expect(expandedIdentity).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByPlaceholderText('Search names, hashes, interfaces, or applications'))
      .toHaveValue('');
    expect(expandedIdentity).toHaveClass('search-match');
    expect(screen.getByRole('button', { name: /Destination: Field station/ }))
      .toHaveClass('search-match');
    expect(screen.getByRole('button', { name: /Destination: Workshop/ }))
      .toHaveClass('search-match');
    const identityWrapper = expandedIdentity.closest('.svelte-flow__node') as HTMLElement;
    const destinationWrapper = screen.getByText('Field station')
      .closest('.svelte-flow__node') as HTMLElement;

    await fireEvent.click(expandedIdentity);

    expect(Number(identityWrapper.style.zIndex))
      .toBeGreaterThan(Number(destinationWrapper.style.zIndex));
    await waitFor(() => expect(screen.queryByText('Field station')).not.toBeInTheDocument());
    expect(screen.queryByText('Workshop')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: /2 destinations, collapsed/ }));
    expect(await screen.findByText('Field station')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Fit network' }));

    await waitFor(() => expect(screen.queryByText('Field station')).not.toBeInTheDocument());
    expect(screen.queryByText('Workshop')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /2 destinations, collapsed/ }))
      .toHaveAttribute('aria-expanded', 'false');
  });

  it('expands and highlights every ingress occurrence of one identity together', async () => {
    const secondInterface: InterfaceConfig = {
      ...websocket,
      id: 'websocket-2',
      name: 'Field relay',
    };
    const secondDestinationHash = 'e'.repeat(32);
    const publicKey = 'f'.repeat(128);
    const identityHash = '1'.repeat(32);
    interfaceConfigurations.set([websocket, secondInterface]);
    interfaceStatuses.set({
      [websocket.id]: 'online',
      [secondInterface.id]: 'online',
    });
    pathTableEntries.set([
      { destinationHash, interfaceId: websocket.id, hops: 1 },
      { destinationHash: secondDestinationHash, interfaceId: secondInterface.id, hops: 1 },
    ]);
    remoteDestinationInventory.set([
      { destinationHash, publicKey, identityHash },
      { destinationHash: secondDestinationHash, publicKey, identityHash },
    ]);
    knownDestinations.set([
      { destinationHash, displayName: 'Field station', fullDestinationName: 'nomadnetwork.node' },
      { destinationHash: secondDestinationHash, displayName: 'Workshop', fullDestinationName: 'lxmf.delivery' },
    ]);
    render(NetworkVisualizerView);

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Group by identity' }));
    const collapsedOccurrences = await screen.findAllByRole('button', {
      name: /2 destinations, collapsed/,
    });
    expect(collapsedOccurrences).toHaveLength(2);
    expect(collapsedOccurrences.every((node) => node.textContent?.includes('2'))).toBe(true);

    await fireEvent.click(collapsedOccurrences[0]);

    const expandedOccurrences = await screen.findAllByRole('button', {
      name: /2 destinations, expanded/,
    });
    expect(expandedOccurrences).toHaveLength(2);
    expect(expandedOccurrences.every((node) => node.classList.contains('search-match'))).toBe(true);
    expect(await screen.findByText('Field station')).toBeInTheDocument();
    expect(screen.getByText('Workshop')).toBeInTheDocument();

    await fireEvent.click(expandedOccurrences[1]);

    await waitFor(() => expect(screen.queryByText('Field station')).not.toBeInTheDocument());
    expect(screen.queryByText('Workshop')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /2 destinations, collapsed/ })).toHaveLength(2);
  });

  it('collapses expanded identities on Escape or an ordinary outside click, but not node or drag gestures', async () => {
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const secondDestinationHash = 'e'.repeat(32);
    const publicKey = 'f'.repeat(128);
    const identityHash = '1'.repeat(32);
    pathTableEntries.set([
      { destinationHash, interfaceId: websocket.id, hops: 1 },
      { destinationHash: secondDestinationHash, interfaceId: websocket.id, hops: 1 },
    ]);
    remoteDestinationInventory.set([
      { destinationHash, publicKey, identityHash },
      { destinationHash: secondDestinationHash, publicKey, identityHash },
    ]);
    knownDestinations.set([
      { destinationHash, displayName: 'Field station', fullDestinationName: 'nomadnetwork.node' },
      { destinationHash: secondDestinationHash, displayName: 'Workshop', fullDestinationName: 'lxmf.delivery' },
    ]);
    const { container } = render(NetworkVisualizerView);
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Group by identity' }));
    const expand = async (): Promise<void> => {
      await fireEvent.click(await screen.findByRole('button', { name: /2 destinations, collapsed/ }));
      await screen.findByRole('button', { name: /2 destinations, expanded/ });
    };

    await expand();
    await fireEvent.click(screen.getByRole('button', { name: /Destination: Field station/ }));
    expect(screen.getByRole('button', { name: /2 destinations, expanded/ })).toBeInTheDocument();

    await fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByText('Field station')).not.toBeInTheDocument());

    await expand();
    const pane = container.querySelector('.svelte-flow__pane') as HTMLElement;
    await fireEvent(pane, pointerEvent('pointerdown', {
      button: 0, pointerId: 1, clientX: 10, clientY: 10,
    }));
    await fireEvent(pane, pointerEvent('pointermove', {
      pointerId: 1, clientX: 30, clientY: 10,
    }));
    await fireEvent(pane, pointerEvent('pointerup', {
      button: 0, pointerId: 1, clientX: 30, clientY: 10,
    }));
    await fireEvent.click(pane, { clientX: 30, clientY: 10 });
    expect(screen.getByRole('button', { name: /2 destinations, expanded/ })).toBeInTheDocument();

    const interfaceNode = screen.getByRole('button', { name: /Interface: Community hub/ });
    await fireEvent(interfaceNode, pointerEvent('pointerdown', {
      button: 0, pointerId: 2, clientX: 40, clientY: 40,
    }));
    await fireEvent(interfaceNode, pointerEvent('pointermove', {
      pointerId: 2, clientX: 55, clientY: 55,
    }));
    await fireEvent(interfaceNode, pointerEvent('pointerup', {
      button: 0, pointerId: 2, clientX: 55, clientY: 55,
    }));
    await fireEvent.click(interfaceNode, { clientX: 55, clientY: 55 });
    expect(screen.getByRole('button', { name: /2 destinations, expanded/ })).toBeInTheDocument();

    await fireEvent(pane, pointerEvent('pointerdown', {
      button: 0, pointerId: 3, clientX: 40, clientY: 40,
    }));
    await fireEvent(pane, pointerEvent('pointerup', {
      button: 0, pointerId: 3, clientX: 40, clientY: 40,
    }));
    await fireEvent.click(pane, { clientX: 40, clientY: 40 });
    await waitFor(() => expect(screen.queryByText('Field station')).not.toBeInTheDocument());
  });

  it('redistributes automatic children around a pinned expanded identity', async () => {
    const secondDestinationHash = 'e'.repeat(32);
    const addedDestinationHash = '9'.repeat(32);
    const publicKey = 'f'.repeat(128);
    const identityHash = '1'.repeat(32);
    const initialPaths = [
      { destinationHash, interfaceId: websocket.id, hops: 1 },
      { destinationHash: secondDestinationHash, interfaceId: websocket.id, hops: 1 },
    ];
    pathTableEntries.set(initialPaths);
    remoteDestinationInventory.set([
      { destinationHash, publicKey, identityHash },
      { destinationHash: secondDestinationHash, publicKey, identityHash },
      { destinationHash: addedDestinationHash, publicKey, identityHash },
    ]);
    knownDestinations.set([
      { destinationHash, displayName: 'Field station', fullDestinationName: 'nomadnetwork.node' },
      { destinationHash: secondDestinationHash, displayName: 'Workshop', fullDestinationName: 'lxmf.delivery' },
      { destinationHash: addedDestinationHash, displayName: 'Portable node', fullDestinationName: 'lxmf.delivery' },
    ]);
    render(NetworkVisualizerView);

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Group by identity' }));
    await fireEvent.click(await screen.findByRole('button', { name: /2 destinations, collapsed/ }));
    await screen.findByText('Field station');
    await new Promise<void>((resolve) => window.setTimeout(resolve, 280));

    const identity = screen.getByRole('button', { name: /2 destinations, expanded/ });
    const identityWrapper = identity.closest('.svelte-flow__node') as HTMLElement;
    const destinationWrapper = screen.getByText('Field station')
      .closest('.svelte-flow__node') as HTMLElement;
    const identityPosition = identityWrapper.style.transform;
    const destinationPosition = destinationWrapper.style.transform;

    pathTableEntries.set([
      ...initialPaths,
      { destinationHash: addedDestinationHash, interfaceId: websocket.id, hops: 1 },
    ]);

    expect(await screen.findByText('Portable node')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: /3 destinations, expanded/ }))
      .toBeInTheDocument());
    expect(identityWrapper.style.transform).toBe(identityPosition);
    expect(destinationWrapper.style.transform).not.toBe(destinationPosition);
    const redistributedDestinationPosition = destinationWrapper.style.transform;

    pathTableEntries.set(initialPaths);

    await waitFor(() => expect(screen.queryByText('Portable node')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /2 destinations, expanded/ })).toBeInTheDocument();
    expect(identityWrapper.style.transform).toBe(identityPosition);
    expect(destinationWrapper.style.transform).toBe(redistributedDestinationPosition);

    pathTableEntries.set([initialPaths[0]]);

    await waitFor(() => expect(screen.queryByRole('button', { name: /destinations, expanded/ }))
      .not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Destination: Field station/ }))
      .not.toHaveClass('search-match');

    pathTableEntries.set(initialPaths);

    expect(await screen.findByRole('button', { name: /2 destinations, collapsed/ }))
      .toBeInTheDocument();
    expect(screen.queryByText('Field station')).not.toBeInTheDocument();
  });

  it('copies a destination hash from its context menu', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    try {
      render(NetworkVisualizerView);
      const destination = screen.getByRole('button', {
        name: 'Destination: Field station. Open destination actions.',
      });
      expect(destination).toHaveAttribute('aria-haspopup', 'menu');

      await fireEvent.contextMenu(destination, { clientX: 140, clientY: 180 });

      expect(screen.getByRole('menu', { name: 'Destination actions' })).toBeInTheDocument();
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy destination hash' }));

      expect(writeText).toHaveBeenCalledWith(destinationHash);
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('copies, probes, and drops every cached path of a grouped identity', async () => {
    const secondDestinationHash = 'e'.repeat(32);
    const unrelatedDestinationHash = '9'.repeat(32);
    const publicKey = 'f'.repeat(128);
    const identityHash = '1'.repeat(32);
    pathTableEntries.set([
      { destinationHash, interfaceId: websocket.id, hops: 1 },
      { destinationHash: secondDestinationHash, interfaceId: websocket.id, hops: 1 },
      { destinationHash: unrelatedDestinationHash, interfaceId: websocket.id, hops: 1 },
    ]);
    remoteDestinationInventory.set([
      { destinationHash, publicKey, identityHash },
      { destinationHash: secondDestinationHash, publicKey, identityHash },
      {
        destinationHash: unrelatedDestinationHash,
        publicKey: '8'.repeat(128),
        identityHash: '7'.repeat(32),
      },
    ]);
    knownDestinations.set([
      { destinationHash, displayName: 'Field station', fullDestinationName: 'nomadnetwork.node' },
      { destinationHash: secondDestinationHash, displayName: 'Workshop', fullDestinationName: 'lxmf.delivery' },
      { destinationHash: unrelatedDestinationHash, displayName: 'Relay', fullDestinationName: 'lxmf.delivery' },
    ]);
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const probe = vi.spyOn(reticulumRuntime, 'probeDestination').mockResolvedValue({
      ok: true,
      destinationHash: '6'.repeat(32),
      fullDestinationName: 'rnstransport.probe',
      probeSizeBytes: 8,
      roundTripTimeMs: 18,
    });
    const drop = vi.spyOn(reticulumRuntime, 'dropDestinationPaths').mockResolvedValue({
      ok: true,
      count: 2,
    });

    try {
      render(NetworkVisualizerView);
      await fireEvent.click(screen.getByRole('checkbox', { name: 'Group by identity' }));
      const identity = await screen.findByRole('button', { name: /2 destinations, collapsed/ });
      expect(identity).toHaveAttribute('aria-haspopup', 'menu');

      await fireEvent.contextMenu(identity, { clientX: 140, clientY: 180 });
      expect(screen.getByRole('menu', { name: 'Identity actions' })).toBeInTheDocument();
      expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual([
        'Copy identity hash',
        'Probe identity',
        'Drop all paths of identity',
      ]);
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy identity hash' }));
      expect(writeText).toHaveBeenCalledWith(identityHash);

      await fireEvent.contextMenu(identity, { clientX: 140, clientY: 180 });
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Probe identity' }));
      expect(probe).toHaveBeenCalledWith(
        identityHash,
        'rnstransport.probe',
        20_000,
        8,
        expect.any(AbortSignal),
      );

      await fireEvent.contextMenu(identity, { clientX: 140, clientY: 180 });
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Drop all paths of identity' }));
      const dialog = screen.getByRole('alertdialog');
      expect(dialog).toHaveTextContent(`Drop 2 cached paths for identity ${identityHash.slice(0, 8)}…${identityHash.slice(-6)}?`);
      expect(drop).not.toHaveBeenCalled();
      await fireEvent.click(screen.getByRole('button', { name: 'Drop all paths' }));

      await waitFor(() => expect(drop).toHaveBeenCalledTimes(1));
      expect(drop).toHaveBeenCalledWith([destinationHash, secondDestinationHash]);
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('copies an immediate next-hop hash from its context menu', async () => {
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    try {
      render(NetworkVisualizerView);
      const nextHop = screen.getByRole('button', {
        name: `Transport node: ${nextHopHash.slice(0, 8)}…${nextHopHash.slice(-6)}. Open transport-node actions.`,
      });

      await fireEvent.contextMenu(nextHop, { clientX: 140, clientY: 180 });

      expect(screen.getByRole('menu', { name: 'Transport-node actions' })).toBeInTheDocument();
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy identity hash' }));
      expect(writeText).toHaveBeenCalledWith(nextHopHash);
    } finally {
      if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
      else Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('keeps transport-node actions on an identity-grouped immediate transport node', async () => {
    remoteDestinationInventory.set([{
      destinationHash,
      publicKey: 'f'.repeat(128),
      identityHash: nextHopHash,
    }]);
    render(NetworkVisualizerView);

    await fireEvent.click(screen.getByRole('checkbox', { name: 'Group by identity' }));
    const transportIdentity = await screen.findByRole('button', {
      name: `Transport identity: ${nextHopHash.slice(0, 8)}…${nextHopHash.slice(-6)}. Open transport-node actions.`,
    });
    await fireEvent.contextMenu(transportIdentity, { clientX: 140, clientY: 180 });

    expect(screen.getByRole('menu', { name: 'Transport-node actions' })).toBeInTheDocument();
    expect(screen.queryByRole('menu', { name: 'Identity actions' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Probe transport node' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Drop all paths via transport node' }))
      .toBeInTheDocument();
  });

  it('probes a destination from the shared destination action', async () => {
    destinationPathStatuses.set({
      [destinationHash]: { destinationHash, hasPath: true, hops: 3 },
    });
    const probe = vi.spyOn(reticulumRuntime, 'probeDestination').mockResolvedValue({
      ok: true,
      destinationHash,
      fullDestinationName: 'nomadnetwork.node',
      probeSizeBytes: 8,
      roundTripTimeMs: 24,
    });
    render(NetworkVisualizerView);

    await fireEvent.contextMenu(screen.getByRole('button', { name: /Destination: Field station/ }), {
      clientX: 140,
      clientY: 180,
    });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Probe destination' }));

    expect(probe).toHaveBeenCalledWith(
      destinationHash,
      'nomadnetwork.node',
      22_000,
      8,
      expect.any(AbortSignal),
    );
  });

  it('recognizes an inventory-only probe destination and enables its probe action', async () => {
    knownDestinations.set([]);
    remoteDestinationInventory.set([{
      destinationHash,
      fullDestinationName: 'rnstransport.probe',
    }]);
    const probe = vi.spyOn(reticulumRuntime, 'probeDestination').mockResolvedValue({
      ok: true,
      destinationHash,
      fullDestinationName: 'rnstransport.probe',
      probeSizeBytes: 8,
      roundTripTimeMs: 12,
    });
    render(NetworkVisualizerView);

    await fireEvent.contextMenu(screen.getByRole('button', { name: /^Destination:/ }), {
      clientX: 140,
      clientY: 180,
    });
    const probeAction = screen.getByRole('menuitem', { name: 'Probe destination' });
    expect(probeAction).toBeEnabled();
    await fireEvent.click(probeAction);

    expect(probe).toHaveBeenCalledWith(
      destinationHash,
      'rnstransport.probe',
      20_000,
      8,
      expect.any(AbortSignal),
    );
  });

  it('probes the transport identity behind an immediate next hop', async () => {
    const probe = vi.spyOn(reticulumRuntime, 'probeDestination').mockResolvedValue({
      ok: true,
      destinationHash: 'f'.repeat(32),
      fullDestinationName: 'rnstransport.probe',
      probeSizeBytes: 8,
      roundTripTimeMs: 18,
    });
    render(NetworkVisualizerView);

    await fireEvent.contextMenu(screen.getByRole('button', { name: /Transport node:/ }), {
      clientX: 140,
      clientY: 180,
    });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Probe transport node' }));

    expect(probe).toHaveBeenCalledWith(
      nextHopHash,
      'rnstransport.probe',
      20_000,
      8,
      expect.any(AbortSignal),
    );
  });

  it('confirms and drops every cached path using an immediate next hop', async () => {
    const otherNextHop = '9'.repeat(32);
    const secondDestinationHash = 'e'.repeat(32);
    const unrelatedDestinationHash = 'f'.repeat(32);
    pathTableEntries.set([
      { destinationHash, nextHop: nextHopHash, interfaceId: websocket.id, hops: 3 },
      { destinationHash: secondDestinationHash, nextHop: nextHopHash, interfaceId: websocket.id, hops: 4 },
      { destinationHash: unrelatedDestinationHash, nextHop: otherNextHop, interfaceId: websocket.id, hops: 3 },
    ]);
    knownDestinations.set([
      { destinationHash, displayName: 'Field station', fullDestinationName: 'nomadnetwork.node' },
      { destinationHash: secondDestinationHash, displayName: 'Workshop', fullDestinationName: 'lxmf.delivery' },
      { destinationHash: unrelatedDestinationHash, displayName: 'Relay', fullDestinationName: 'lxmf.delivery' },
    ]);
    const drop = vi.spyOn(reticulumRuntime, 'dropDestinationPaths').mockResolvedValue({
      ok: true,
      count: 2,
    });
    render(NetworkVisualizerView);

    await fireEvent.contextMenu(screen.getByRole('button', {
      name: `Transport node: ${nextHopHash.slice(0, 8)}…${nextHopHash.slice(-6)}. Open transport-node actions.`,
    }), { clientX: 140, clientY: 180 });
    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems.at(-1)).toHaveAccessibleName('Drop all paths via transport node');
    await fireEvent.click(menuItems.at(-1)!);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent(`Drop 2 cached paths that use transport node ${nextHopHash.slice(0, 8)}…${nextHopHash.slice(-6)}?`);
    expect(drop).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Drop all paths' }));

    await waitFor(() => expect(drop).toHaveBeenCalledTimes(1));
    expect(drop).toHaveBeenCalledWith([destinationHash, secondDestinationHash]);
  });

  it('drops the cached route before requesting a replacement path', async () => {
    const calls: string[] = [];
    vi.spyOn(reticulumRuntime, 'dropDestinationPath').mockImplementation(async () => {
      calls.push('drop');
      return true;
    });
    vi.spyOn(reticulumRuntime, 'requestDestinationPath').mockImplementation(async () => {
      calls.push('request');
      return { ok: true, destinationHash, hops: 2 };
    });
    render(NetworkVisualizerView);

    await fireEvent.contextMenu(screen.getByRole('button', { name: /Destination: Field station/ }), {
      clientX: 140,
      clientY: 180,
    });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Request new path' }));

    await waitFor(() => expect(calls).toEqual(['drop', 'request']));
  });

  it('drops a destination path from the final context-menu action', async () => {
    const drop = vi.spyOn(reticulumRuntime, 'dropDestinationPath').mockResolvedValue(true);
    render(NetworkVisualizerView);

    await fireEvent.contextMenu(screen.getByRole('button', { name: /Destination: Field station/ }), {
      clientX: 140,
      clientY: 180,
    });
    const actions = screen.getAllByRole('menuitem');
    expect(actions.at(-1)).toHaveAccessibleName('Drop path to destination');
    await fireEvent.click(actions.at(-1)!);

    expect(drop).toHaveBeenCalledWith(destinationHash);
  });

  it('disables and enables a configured interface from its context menu', async () => {
    const saveInterface = vi.spyOn(BrowserSettingsRepository.prototype, 'saveInterface')
      .mockResolvedValue(undefined);
    vi.spyOn(reticulumRuntime, 'applyConfiguration').mockImplementation(async (_preferences, interfaces) => {
      interfaceConfigurations.set(interfaces);
    });
    render(NetworkVisualizerView);
    const interfaceNode = screen.getByRole('button', {
      name: 'Interface: Community hub. Open interface actions.',
    });

    await fireEvent.contextMenu(interfaceNode, { clientX: 140, clientY: 180 });
    expect(screen.getByRole('menu', { name: 'Interface actions' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Disable interface' }));
    await waitFor(() => expect(saveInterface).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: websocket.id, enabled: false }),
    ));

    await fireEvent.contextMenu(interfaceNode, { clientX: 140, clientY: 180 });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Enable interface' }));
    await waitFor(() => expect(saveInterface).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: websocket.id, enabled: true }),
    ));
  });

  it('confirms and drops every cached path using an interface', async () => {
    const secondDestinationHash = 'e'.repeat(32);
    const unrelatedDestinationHash = 'f'.repeat(32);
    pathTableEntries.set([
      { destinationHash, nextHop: nextHopHash, interfaceId: websocket.id, hops: 3 },
      {
        destinationHash: secondDestinationHash,
        nextHop: '8'.repeat(32),
        interfaceId: websocket.id,
        hops: 4,
      },
      {
        destinationHash: unrelatedDestinationHash,
        nextHop: '9'.repeat(32),
        interfaceId: 'other-interface',
        hops: 3,
      },
    ]);
    knownDestinations.set([
      { destinationHash, displayName: 'Field station', fullDestinationName: 'nomadnetwork.node' },
      { destinationHash: secondDestinationHash, displayName: 'Workshop', fullDestinationName: 'lxmf.delivery' },
      { destinationHash: unrelatedDestinationHash, displayName: 'Relay', fullDestinationName: 'lxmf.delivery' },
    ]);
    const drop = vi.spyOn(reticulumRuntime, 'dropDestinationPaths').mockResolvedValue({
      ok: true,
      count: 2,
    });
    render(NetworkVisualizerView);

    await fireEvent.contextMenu(screen.getByRole('button', {
      name: 'Interface: Community hub. Open interface actions.',
    }), { clientX: 140, clientY: 180 });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Drop all paths via interface' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('Drop 2 cached paths that use interface Community hub?');
    expect(drop).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Drop all paths' }));

    await waitFor(() => expect(drop).toHaveBeenCalledTimes(1));
    expect(drop).toHaveBeenCalledWith([destinationHash, secondDestinationHash]);
  });

  it('confirms before removing a configured interface', async () => {
    pathTableEntries.set([]);
    const deleteInterface = vi.spyOn(BrowserSettingsRepository.prototype, 'deleteInterface')
      .mockResolvedValue(undefined);
    vi.spyOn(reticulumRuntime, 'applyConfiguration').mockImplementation(async (_preferences, interfaces) => {
      interfaceConfigurations.set(interfaces);
    });
    render(NetworkVisualizerView);

    await fireEvent.contextMenu(screen.getByRole('button', {
      name: 'Interface: Community hub. Open interface actions.',
    }), { clientX: 140, clientY: 180 });
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Remove interface' }));

    const dialog = screen.getByRole('alertdialog');
    expect(deleteInterface).not.toHaveBeenCalled();
    expect(dialog).toHaveTextContent('Remove Community hub from Retivum?');
    await fireEvent.click(screen.getByRole('button', { name: 'Remove interface' }));

    await waitFor(() => expect(deleteInterface).toHaveBeenCalledWith(websocket.id));
    expect(screen.queryByRole('button', {
      name: 'Interface: Community hub. Open interface actions.',
    })).not.toBeInTheDocument();
  });

  it('keeps replacement path requests disabled for the shared cooldown interval', async () => {
    vi.useFakeTimers();
    vi.spyOn(reticulumRuntime, 'dropDestinationPath').mockResolvedValue(true);
    vi.spyOn(reticulumRuntime, 'requestDestinationPath').mockResolvedValue({
      ok: true,
      destinationHash,
      hops: 2,
    });

    try {
      render(NetworkVisualizerView);
      const destination = screen.getByRole('button', { name: /Destination: Field station/ });
      await fireEvent.contextMenu(destination, { clientX: 140, clientY: 180 });
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Request new path' }));
      await vi.advanceTimersByTimeAsync(0);

      await fireEvent.contextMenu(destination, { clientX: 140, clientY: 180 });
      expect(screen.getByRole('menuitem', { name: 'Request new path' })).toBeDisabled();

      await vi.advanceTimersByTimeAsync(20_000);
      expect(screen.getByRole('menuitem', { name: 'Request new path' })).toBeEnabled();
    } finally {
      clearDestinationPathRequestCooldowns();
      vi.useRealTimers();
    }
  });

  it('dims the graph without removing routes when a search has no matches', async () => {
    render(NetworkVisualizerView);

    await fireEvent.input(screen.getByLabelText('Search network nodes'), { target: { value: 'missing' } });

    expect(screen.queryByText('No matching routes')).not.toBeInTheDocument();
    expect(screen.getByText('matching routes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Destination: Field station/ })).toHaveClass('search-dimmed');
    expect(screen.queryByText(/This is a local routing view/)).not.toBeInTheDocument();
  });

  it('clears and unfocuses the search field with Escape', async () => {
    render(NetworkVisualizerView);
    const search = screen.getByLabelText('Search network nodes');

    search.focus();
    await fireEvent.input(search, { target: { value: 'field' } });
    expect(search).toHaveFocus();
    expect(search).toHaveValue('field');

    await fireEvent.keyDown(search, { key: 'Escape' });

    expect(search).toHaveValue('');
    expect(search).not.toHaveFocus();
  });

  it('highlights matching route chains and keeps other destinations as dimmed context', async () => {
    const otherDestinationHash = 'e'.repeat(32);
    pathTableEntries.set([
      { destinationHash, nextHop: nextHopHash, interfaceId: 'websocket-1', hops: 3 },
      { destinationHash: otherDestinationHash, interfaceId: 'websocket-1', hops: 1 },
    ]);
    knownDestinations.set([
      { destinationHash, displayName: 'Field station', fullDestinationName: 'nomadnetwork.node' },
      { destinationHash: otherDestinationHash, displayName: 'Workshop', fullDestinationName: 'lxmf.delivery' },
    ]);
    render(NetworkVisualizerView);

    await fireEvent.input(screen.getByLabelText('Search network nodes'), { target: { value: 'field' } });

    expect(screen.getByRole('button', { name: /Destination: Field station/ })).toHaveClass('search-match');
    expect(screen.getByRole('button', { name: /Destination: Workshop/ })).toHaveClass('search-dimmed');
    expect(screen.getByText('matching route')).toBeInTheDocument();
  });

  it('renders a draggable, icon-led graph through Svelte Flow', () => {
    const { container } = render(NetworkVisualizerView);

    expect(container.querySelector('[data-testid="svelte-flow__wrapper"]')).toBeInTheDocument();
    expect(container.querySelectorAll('.svelte-flow__node-network')).toHaveLength(4);
    expect(container.querySelectorAll('.svelte-flow__node-network.draggable')).toHaveLength(4);
    expect(container.querySelector('.svelte-flow__node[data-id="interface:websocket-1"]'))
      .toHaveStyle({ width: '62px', height: '62px' });
    expect(container.querySelector('.svelte-flow__background-pattern')).toBeInTheDocument();
    expect(container.querySelectorAll('.network-flow-badge svg')).toHaveLength(4);
  });

  it('filters routes from the numeric maximum-hop field', async () => {
    render(NetworkVisualizerView);

    await fireEvent.input(screen.getByLabelText('Maximum hops'), { target: { value: '2' } });

    expect(screen.getByText('No matching routes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Destination: Field station/ })).not.toBeInTheDocument();
  });

  it('restores the default maximum hops after an empty field loses focus', async () => {
    render(NetworkVisualizerView);
    const maximumHops = screen.getByLabelText('Maximum hops');

    await fireEvent.input(maximumHops, { target: { value: '' } });
    expect(maximumHops).toHaveValue(null);

    await fireEvent.blur(maximumHops);
    expect(maximumHops).toHaveValue(5);
  });

  it('keeps grouping and maximum hops when the tool is closed and reopened', async () => {
    const firstView = render(NetworkVisualizerView);

    await fireEvent.input(screen.getByLabelText('Maximum hops'), { target: { value: '2' } });
    await fireEvent.click(screen.getByRole('checkbox', { name: 'Group by identity' }));
    firstView.unmount();

    render(NetworkVisualizerView);

    expect(screen.getByLabelText('Maximum hops')).toHaveValue(2);
    expect(screen.getByRole('checkbox', { name: 'Group by identity' })).toBeChecked();
  });

  it('uses Svelte Flow for pan, wheel, pinch and resetting the arrangement', async () => {
    const { container } = render(NetworkVisualizerView);

    const graph = screen.getByRole('application', {
      name: 'Interactive local Reticulum route graph with 1 routes across 1 interfaces.',
    });
    expect(graph).toHaveClass('svelte-flow');
    expect(container.querySelector('.svelte-flow__pane')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zoom out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fit network' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Fit network' }));
    expect(container.querySelectorAll('.svelte-flow__node-network')).toHaveLength(4);
    expect(screen.queryByRole('button', { name: 'Reset arrangement' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Drag to pan/)).not.toBeInTheDocument();
  });

  it('stacks the graph controls vertically at every viewport size', async () => {
    const desktop = render(NetworkVisualizerView);

    expect(desktop.container.querySelector('.network-flow-controls')).toHaveClass('vertical');
    desktop.unmount();

    vi.stubGlobal('matchMedia', vi.fn(() => ({
      matches: true,
      media: '(max-width: 600px)',
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));
    const compact = render(NetworkVisualizerView);

    await waitFor(() => expect(compact.container.querySelector('.network-flow-controls'))
      .toHaveClass('vertical'));
  });

  it('returns to the Tools route', async () => {
    render(NetworkVisualizerView);

    await fireEvent.click(screen.getByRole('button', { name: 'Back to Tools' }));

    expect(window.location.hash).toBe('#/tools');
  });
});
