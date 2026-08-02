import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProvisioningNode } from '../../domain/provisioning';
import { ProvisioningClient } from '../../infrastructure/reticulum/provisioning-client';
import { clearProbeHistory, probeHistory } from '../../infrastructure/reticulum/probe-history';
import type { ProbeResult } from '../../infrastructure/reticulum/protocol';
import {
  destinationPathStatuses,
  knownDestinations,
  provisioningBookmarks,
  remoteDestinationInventory,
  reticulumRuntime,
} from '../../infrastructure/reticulum/runtime';
import ToastViewport from '../../lib/components/ToastViewport.svelte';
import { clearToasts } from '../../lib/notifications/toasts';
import ProvisioningView from './ProvisioningView.svelte';

const announcedNode: ProvisioningNode = {
  id: '1'.repeat(32),
  destinationHash: '1'.repeat(32),
  lastAnnouncedAt: '2026-07-20T10:00:00.000Z',
};

function setProvisioningNodes(nodes: ProvisioningNode[]): void {
  knownDestinations.set(nodes.map((node) => ({
    destinationHash: node.destinationHash,
    fullDestinationName: 'rnstransport.remote.management',
    lastAnnouncedAt: node.lastAnnouncedAt,
    metadata: {},
  })));
  provisioningBookmarks.set(nodes.filter((node) => node.bookmarked).map((node) => ({
    id: node.id,
    destinationHash: node.destinationHash,
    label: node.label,
    createdAt: node.lastAnnouncedAt ?? '2026-07-20T10:00:00.000Z',
    updatedAt: node.lastAnnouncedAt ?? '2026-07-20T10:00:00.000Z',
  })));
}

describe('ProvisioningView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setProvisioningNodes([]);
    remoteDestinationInventory.set([]);
    destinationPathStatuses.set({});
    clearProbeHistory();
    clearToasts();
  });

  it('connects to a valid custom hash, hides the directory, and locks the address field', async () => {
    let requestedNode: ProvisioningNode | undefined;
    vi.spyOn(ProvisioningClient.prototype, 'load').mockImplementation(function (this: ProvisioningClient) {
      requestedNode = this.provisioningNode;
      return new Promise(() => {});
    });
    render(ProvisioningView);

    expect(screen.getByRole('heading', { name: 'No management destinations heard' })).toBeInTheDocument();
    const input = screen.getByPlaceholderText('Management destination hash');
    const connect = screen.getByRole('button', { name: /Connect/ });
    await fireEvent.input(input, { target: { value: 'a'.repeat(32) } });
    await fireEvent.submit(input.closest('form')!);

    expect(requestedNode).toMatchObject({
      id: 'a'.repeat(32),
      destinationHash: 'a'.repeat(32),
    });
    expect(screen.queryByRole('heading', { name: 'No management destinations heard' })).not.toBeInTheDocument();
    expect(screen.getByText('Finding a path to the device…')).toBeInTheDocument();
    expect(input).toBeDisabled();
    expect(input.closest('label')).toHaveClass('connection-locked');
    expect(connect).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Connect/ })).not.toBeInTheDocument();
  });

  it('orders disconnect and reload immediately before the destination input', () => {
    render(ProvisioningView);

    const actions = screen.getByRole('group', { name: 'Provisioning connection actions' });
    const inputLabel = screen.getByPlaceholderText('Management destination hash').closest('label');
    const actionButtons = actions.querySelectorAll('button');

    expect(actionButtons[0]).toBe(screen.getByRole('button', { name: 'Disconnect and return to destinations' }));
    expect(actionButtons[1]).toBe(screen.getByRole('button', { name: 'Reload device configuration' }));
    expect(actions.nextElementSibling).toBe(inputLabel);
  });

  it('soft reloads through the existing client without closing its link', async () => {
    setProvisioningNodes([announcedNode]);
    const load = vi.spyOn(ProvisioningClient.prototype, 'load').mockResolvedValue({
      info: { needsReboot: false },
      schema: { namespaces: [] },
      state: {},
    });
    const close = vi.spyOn(reticulumRuntime, 'cancelProvisioning').mockImplementation(() => undefined);
    render(ProvisioningView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(announcedNode.destinationHash) }));
    expect(load).toHaveBeenCalledTimes(1);
    const reload = screen.getByRole('button', { name: 'Reload device configuration' });
    expect(reload).toBeEnabled();
    await fireEvent.click(reload);

    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(close).not.toHaveBeenCalled();
  });

  it('cancels loading, returns to the overview, and can then open another destination', async () => {
    const otherNode: ProvisioningNode = {
      id: '3'.repeat(32),
      destinationHash: '3'.repeat(32),
      lastAnnouncedAt: '2026-07-20T10:01:00.000Z',
    };
    setProvisioningNodes([announcedNode, otherNode]);
    const load = vi.spyOn(ProvisioningClient.prototype, 'load').mockImplementation(() => new Promise(() => {}));
    const close = vi.spyOn(reticulumRuntime, 'cancelProvisioning').mockImplementation(() => undefined);
    render(ProvisioningView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(announcedNode.destinationHash) }));
    expect(screen.queryByRole('button', { name: new RegExp(otherNode.destinationHash) })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel connection and return to destinations' }));

    const otherRow = screen.getByRole('button', { name: new RegExp(otherNode.destinationHash) });
    await fireEvent.click(otherRow);

    expect(close).toHaveBeenCalledWith(announcedNode.destinationHash, true);
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('button', { name: new RegExp(otherNode.destinationHash) })).not.toBeInTheDocument();
  });

  it('keeps the active session open if its announcement leaves the directory', async () => {
    setProvisioningNodes([announcedNode]);
    vi.spyOn(ProvisioningClient.prototype, 'load').mockImplementation(() => new Promise(() => {}));
    render(ProvisioningView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(announcedNode.destinationHash) }));
    setProvisioningNodes([]);

    await waitFor(() => expect(screen.getByText('Finding a path to the device…')).toBeInTheDocument());
    expect(screen.getByPlaceholderText('Management destination hash')).toBeDisabled();
    expect(screen.queryByRole('heading', { name: 'No management destinations heard' })).not.toBeInTheDocument();
  });

  it('shows a load failure only in the main content box', async () => {
    setProvisioningNodes([announcedNode]);
    vi.spyOn(ProvisioningClient.prototype, 'load').mockRejectedValue(new Error('unavailable'));
    render(ProvisioningView);
    render(ToastViewport);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(announcedNode.destinationHash) }));

    expect(await screen.findByRole('heading', { name: 'Device configuration unavailable' })).toBeInTheDocument();
    expect(screen.getByText('Try loading this device again when a path is available.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('disconnects a loaded destination and restores the unlocked overview', async () => {
    setProvisioningNodes([announcedNode]);
    vi.spyOn(ProvisioningClient.prototype, 'load').mockResolvedValue({
      info: { needsReboot: false },
      schema: { namespaces: [] },
      state: {},
    });
    const close = vi.spyOn(reticulumRuntime, 'cancelProvisioning').mockImplementation(() => undefined);
    render(ProvisioningView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(announcedNode.destinationHash) }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect and return to destinations' })).toBeEnabled());
    expect(screen.queryByRole('button', { name: /Connect/ })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Disconnect and return to destinations' }));

    expect(close).toHaveBeenCalledWith(announcedNode.destinationHash, true);
    expect(screen.getByRole('button', { name: new RegExp(announcedNode.destinationHash) })).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Management destination hash')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Connect' })).toBeEnabled();
  });

  it('closes every provisioning link when leaving the tool', () => {
    const closeProvisioning = vi.spyOn(reticulumRuntime, 'closeProvisioning').mockImplementation(() => undefined);
    const view = render(ProvisioningView);

    view.unmount();

    expect(closeProvisioning).toHaveBeenCalledOnce();
  });

  it('uses the shared naming editor from a destination context menu', async () => {
    setProvisioningNodes([announcedNode]);
    knownDestinations.update((records) => records.map((record) => ({
      ...record,
      displayName: record.destinationHash === announcedNode.destinationHash
        ? 'Management node'
        : record.displayName,
    })));
    const bookmark = vi.spyOn(reticulumRuntime, 'saveProvisioningNodeBookmark').mockResolvedValue(true);
    render(ProvisioningView);

    const row = screen.getByRole('button', { name: /Management node/ });
    await fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    expect(screen.getByRole('menu', { name: 'Management destination actions' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Add bookmark' }));

    expect(screen.getByRole('heading', { name: 'Add bookmark' })).toBeInTheDocument();
    const name = screen.getByRole('textbox', { name: 'Bookmark name' });
    expect(name).toHaveValue('');
    expect(name).toBeRequired();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(name).toHaveAttribute('placeholder', 'My management destination');
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    await fireEvent.input(name, { target: { value: '  Workshop router  ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(bookmark).toHaveBeenCalledWith(
      expect.objectContaining({ id: announcedNode.id }),
      'Workshop router',
    ));
  });

  it('uses a NomadNet name shared by the management destination identity', () => {
    const nomadDestinationHash = '9'.repeat(32);
    const publicKey = '8'.repeat(128);
    setProvisioningNodes([announcedNode]);
    knownDestinations.update((records) => [...records, {
      destinationHash: nomadDestinationHash,
      fullDestinationName: 'nomadnetwork.node',
      displayName: 'Forest Node',
      lastAnnouncedAt: '2026-07-20T10:01:00.000Z',
      metadata: {},
    }]);
    remoteDestinationInventory.set([{
      destinationHash: announcedNode.destinationHash,
      publicKey,
      fullDestinationName: 'rnstransport.remote.management',
    }, {
      destinationHash: nomadDestinationHash,
      publicKey,
      fullDestinationName: 'nomadnetwork.node',
    }]);

    render(ProvisioningView);

    expect(screen.getByRole('button', { name: /Forest Node/ })).toBeInTheDocument();
  });

  it('prefers bookmark name, then exact display name, then shared identity name', async () => {
    const nomadDestinationHash = '7'.repeat(32);
    const publicKey = '6'.repeat(128);
    setProvisioningNodes([announcedNode]);
    knownDestinations.update((records) => [
      ...records.map((record) => (
        record.destinationHash === announcedNode.destinationHash
          ? { ...record, displayName: 'Management Name' }
          : record
      )),
      {
        destinationHash: nomadDestinationHash,
        fullDestinationName: 'nomadnetwork.node',
        displayName: 'Shared Name',
        metadata: {},
      },
    ]);
    remoteDestinationInventory.set([{
      destinationHash: announcedNode.destinationHash,
      publicKey,
      fullDestinationName: 'rnstransport.remote.management',
    }, {
      destinationHash: nomadDestinationHash,
      publicKey,
      fullDestinationName: 'nomadnetwork.node',
    }]);
    render(ProvisioningView);

    expect(screen.getByRole('button', { name: /Management Name/ })).toBeInTheDocument();
    expect(screen.queryByText('Shared Name')).not.toBeInTheDocument();

    provisioningBookmarks.set([{
      id: announcedNode.id,
      destinationHash: announcedNode.destinationHash,
      label: 'Bookmark Name',
      createdAt: '2026-07-20T10:00:00.000Z',
      updatedAt: '2026-07-20T10:00:00.000Z',
    }]);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Bookmark Name/ })).toBeInTheDocument();
    });
    expect(screen.queryByText('Management Name')).not.toBeInTheDocument();
    expect(screen.queryByText('Shared Name')).not.toBeInTheDocument();
  });

  it('probes a management destination with its name and provisioning aspect', async () => {
    setProvisioningNodes([announcedNode]);
    knownDestinations.update((records) => records.map((record) => ({
      ...record,
      displayName: record.destinationHash === announcedNode.destinationHash
        ? 'Workshop router'
        : record.displayName,
    })));
    destinationPathStatuses.set({
      [announcedNode.destinationHash]: {
        destinationHash: announcedNode.destinationHash,
        hasPath: true,
        hops: 2,
      },
    });
    let resolveProbe!: (result: ProbeResult) => void;
    const probe = vi.spyOn(reticulumRuntime, 'probeDestination').mockImplementation(() => new Promise((resolve) => {
      resolveProbe = resolve;
    }));
    render(ProvisioningView);
    render(ToastViewport);

    const row = screen.getByRole('button', { name: /Workshop router/ });
    await fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    const menuItems = screen.getAllByRole('menuitem');
    const copyIndex = menuItems.findIndex((item) => item.textContent?.includes('Copy destination hash'));
    expect(menuItems[copyIndex + 1]).toHaveTextContent('Probe destination');

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Probe destination' }));
    expect(probe).toHaveBeenCalledWith(
      announcedNode.destinationHash,
      'rnstransport.probe',
      18_000,
      8,
      expect.any(AbortSignal),
    );
    expect(await screen.findByRole('status')).toHaveTextContent(
      `Probe sent to Workshop router <${announcedNode.destinationHash.slice(0, 8)}…${announcedNode.destinationHash.slice(-6)}>. Waiting for a response…`,
    );
    expect(screen.getByRole('button', { name: 'Cancel activity' })).toBeInTheDocument();

    resolveProbe({
      ok: true,
      destinationHash: announcedNode.destinationHash,
      fullDestinationName: 'rnstransport.probe',
      probeSizeBytes: 8,
      roundTripTimeMs: 1_250,
      hops: 2,
    });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      `Probe to Workshop router <${announcedNode.destinationHash.slice(0, 8)}…${announcedNode.destinationHash.slice(-6)}> succeeded in 1.3 s.`,
    ));
    expect(get(probeHistory)[0]).toEqual(expect.objectContaining({
      destinationHash: announcedNode.destinationHash,
      fullDestinationName: 'rnstransport.probe',
      ok: true,
    }));
  });

  it('replaces the bookmarked destination overview with the loaded configuration', async () => {
    const bookmarkedNode = { ...announcedNode, bookmarked: true, label: 'Workshop router' };
    setProvisioningNodes([bookmarkedNode]);
    vi.spyOn(ProvisioningClient.prototype, 'load').mockResolvedValue({
      info: { needsReboot: false },
      schema: { namespaces: [] },
      state: {},
    });
    render(ProvisioningView);

    const row = screen.getByRole('button', { name: /Workshop router/ });
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    await fireEvent.contextMenu(row, { clientX: 100, clientY: 100 });
    expect(screen.getByRole('menuitem', { name: 'Edit bookmark' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Remove bookmark' })).toBeInTheDocument();
    await fireEvent.keyDown(window, { key: 'Escape' });
    await fireEvent.click(row);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Workshop router' })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Workshop router/ })).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('Management destination hash')).toBeDisabled();
  });

  it('leaves the title empty for an unnamed management bookmark', () => {
    setProvisioningNodes([{ ...announcedNode, bookmarked: true }]);
    render(ProvisioningView);

    const row = screen.getByRole('button', { name: new RegExp(announcedNode.destinationHash) });
    expect(row).not.toHaveTextContent('microReticulum device');
    expect(row.querySelector('strong')).not.toBeInTheDocument();
  });

  it('leaves the title empty for an unnamed management announce', () => {
    setProvisioningNodes([announcedNode]);
    render(ProvisioningView);

    const row = screen.getByRole('button', { name: new RegExp(announcedNode.destinationHash) });
    expect(row).not.toHaveTextContent('microReticulum device');
    expect(row.querySelector('strong')).not.toBeInTheDocument();
  });

  it('returns to the tools directory', async () => {
    window.location.hash = '#/provisioning';
    render(ProvisioningView);

    await fireEvent.click(screen.getByRole('button', { name: 'Back to Tools' }));
    expect(window.location.hash).toBe('#/tools');
  });
});
