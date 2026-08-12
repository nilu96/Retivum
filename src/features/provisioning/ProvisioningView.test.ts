import { fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  provisioningFieldFlags,
  provisioningFieldTypes,
  type ProvisioningNode,
} from '../../domain/provisioning';
import {
  ProvisioningClient,
  ProvisioningFieldFailure,
} from '../../infrastructure/reticulum/provisioning-client';
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

  it('clears the shared bookmarks and announces search', async () => {
    render(ProvisioningView);

    const input = screen.getByPlaceholderText('Search devices');
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();

    await fireEvent.input(input, { target: { value: 'needle' } });
    expect(input).toHaveValue('needle');
    await fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(input).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Clear search' })).not.toBeInTheDocument();
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
    expect(screen.queryByRole('combobox', { name: 'Provisioning section' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Remote provisioning' })).toBeInTheDocument();
    expect(screen.getByText(`Currently connected to ${'a'.repeat(32)}`)).toBeInTheDocument();
    expect(screen.queryByText(
      'Discover and configure authorized microReticulum devices over the active Reticulum network.',
    )).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: new RegExp(`Remote provisioning:.*${'a'.repeat(8)}`) }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy management destination' })).not.toBeInTheDocument();
  });

  it('orders disconnect and reload immediately before the destination input', () => {
    render(ProvisioningView);

    const actions = screen.getByRole('group', { name: 'Provisioning connection actions' });
    const inputLabel = screen.getByPlaceholderText('Management destination hash').closest('label');
    const actionButtons = actions.querySelectorAll('button');

    expect(actionButtons[0]).toBe(screen.getByRole('button', { name: 'Disconnect and return to destinations' }));
    expect(actionButtons[1]).toBe(screen.getByRole('button', { name: 'Refresh current section' }));
    expect(actions.nextElementSibling).toBe(inputLabel?.parentElement);
  });

  it('refreshes node status through the existing client without reloading or closing its link', async () => {
    setProvisioningNodes([announcedNode]);
    const load = vi.spyOn(ProvisioningClient.prototype, 'load').mockResolvedValue({
      info: { needsReboot: false },
      schema: { namespaces: [] },
      state: {},
    });
    const getInfo = vi.spyOn(ProvisioningClient.prototype, 'getInfo').mockResolvedValue({
      firmwareVersion: '2.0.0',
      schemaVersion: 2,
      needsReboot: true,
    });
    const close = vi.spyOn(reticulumRuntime, 'cancelProvisioning').mockImplementation(() => undefined);
    render(ProvisioningView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(announcedNode.destinationHash) }));
    expect(load).toHaveBeenCalledTimes(1);
    const refresh = screen.getByRole('button', { name: 'Refresh current section' });
    expect(refresh).toBeEnabled();
    await fireEvent.click(refresh);

    await waitFor(() => expect(getInfo).toHaveBeenCalledOnce());
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByText('2.0.0')).toBeInTheDocument();
    const rebootStatus = screen.getByText('Reboot required').closest('div');
    expect(within(rebootStatus!).getByText('Yes')).toBeInTheDocument();
    expect(screen.getByText('Pending changes').closest('div')).toHaveTextContent('None');
    expect(close).not.toHaveBeenCalled();
  });

  it('allows the connected device to be rebooted from node status', async () => {
    setProvisioningNodes([announcedNode]);
    vi.spyOn(ProvisioningClient.prototype, 'load').mockResolvedValue({
      info: { firmwareVersion: '1.2.3', needsReboot: false },
      schema: { namespaces: [] },
      state: {},
    });
    const reboot = vi.spyOn(ProvisioningClient.prototype, 'reboot').mockResolvedValue();
    const nativeConfirm = vi.spyOn(window, 'confirm');
    render(ProvisioningView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(announcedNode.destinationHash) }));
    await fireEvent.click(await screen.findByRole('button', { name: 'Reboot device' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Reboot device' });
    expect(within(dialog).getByText('Reboot this device now?')).toBeInTheDocument();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Reboot device' }));

    await waitFor(() => expect(reboot).toHaveBeenCalledOnce());
    expect(nativeConfirm).not.toHaveBeenCalled();
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

  it('closes the failed link and performs a full reload through a fresh client', async () => {
    setProvisioningNodes([announcedNode]);
    const clients: ProvisioningClient[] = [];
    const load = vi.spyOn(ProvisioningClient.prototype, 'load').mockImplementation(function (this: ProvisioningClient) {
      clients.push(this);
      if (clients.length === 1) return Promise.reject(new Error('unavailable'));
      return Promise.resolve({
        info: { firmwareVersion: '2.0.0', needsReboot: false },
        schema: { namespaces: [] },
        state: {},
      });
    });
    const close = vi.spyOn(reticulumRuntime, 'cancelProvisioning').mockImplementation(() => undefined);
    render(ProvisioningView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(announcedNode.destinationHash) }));
    await screen.findByRole('heading', { name: 'Device configuration unavailable' });
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh current section' }));

    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(close).toHaveBeenCalledWith(announcedNode.destinationHash, true);
    expect(clients[1]).not.toBe(clients[0]);
    expect(await screen.findByRole('heading', { name: 'Node status' })).toBeInTheDocument();
    expect(screen.getByText('2.0.0')).toBeInTheDocument();
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

  it('shows the connected node name below the fixed page title', async () => {
    const namedNode: ProvisioningNode = {
      ...announcedNode,
      label: 'Node 123',
      bookmarked: true,
    };
    setProvisioningNodes([namedNode]);
    vi.spyOn(ProvisioningClient.prototype, 'load').mockResolvedValue({
      info: { firmwareVersion: 'microReticulum', needsReboot: false },
      schema: { namespaces: [] },
      state: {},
    });
    const { container } = render(ProvisioningView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(namedNode.destinationHash) }));

    expect(await screen.findByRole('heading', { name: 'Remote provisioning' })).toBeInTheDocument();
    expect(screen.getByText('Currently connected to Node 123')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Node 123' })).not.toBeInTheDocument();
    expect(container.querySelector('.provisioning-device-header')).not.toBeInTheDocument();
  });

  it('uses the destination hash below the title when the connected node has no name', async () => {
    setProvisioningNodes([announcedNode]);
    vi.spyOn(ProvisioningClient.prototype, 'load').mockResolvedValue({
      info: { needsReboot: false },
      schema: { namespaces: [] },
      state: {},
    });
    render(ProvisioningView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(announcedNode.destinationHash) }));

    expect(await screen.findByText(`Currently connected to ${announcedNode.destinationHash}`))
      .toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Remote provisioning' })).toBeInTheDocument();
  });

  it('uses desktop section navigation with node status as the default and keeps the mobile selector in sync', async () => {
    setProvisioningNodes([announcedNode]);
    const load = vi.spyOn(ProvisioningClient.prototype, 'load').mockResolvedValue({
      info: {
        firmwareVersion: '1.2.3',
        schemaVersion: 2,
        needsReboot: false,
      },
      schema: {
        namespaces: [{
          id: 10,
          name: 'RNode General Config',
          parentId: 0,
          fields: [{
            id: 1,
            name: 'Device name',
            type: provisioningFieldTypes.string,
            flags: 0,
          }, {
            id: 2,
            name: 'Remote Management Allowed',
            type: provisioningFieldTypes.bytesList,
            flags: 0,
          }],
        }, {
          id: 11,
          name: 'Radio',
          parentId: 10,
          fields: [{
            id: 1,
            name: 'Radio enabled',
            type: provisioningFieldTypes.boolean,
            flags: 0,
          }],
        }, {
          id: 20,
          name: 'RNode General Metrics',
          parentId: 0,
          fields: [{
            id: 1,
            name: 'Uptime',
            type: provisioningFieldTypes.integer,
            flags: provisioningFieldFlags.readOnly,
          }],
        }, {
          id: 21,
          name: 'Interfaces',
          parentId: 20,
          fields: [],
        }, {
          id: 22,
          name: 'LoRaInterface',
          parentId: 21,
          fields: [{
            id: 1,
            name: 'Frequency',
            type: provisioningFieldTypes.integer,
            flags: provisioningFieldFlags.readOnly,
          }],
        }],
      },
      state: {
        10: { 1: 'Workshop node', 2: [Uint8Array.of(0xaa, 0xbb), Uint8Array.of(0xcc, 0xdd)] },
        11: { 1: true },
        20: { 1: 3600 },
        21: {},
        22: { 1: 869_462_500 },
      },
    });
    const getState = vi.spyOn(ProvisioningClient.prototype, 'getStateSnapshot').mockResolvedValue({
      values: {
        10: { 1: 'Refreshed node' },
        11: { 1: false },
      },
      unchanged: false,
      structured: true,
    });
    const close = vi.spyOn(reticulumRuntime, 'cancelProvisioning').mockImplementation(() => undefined);
    render(ProvisioningView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(announcedNode.destinationHash) }));

    const sectionNavigation = await screen.findByRole('navigation', { name: 'Provisioning section' });
    const statusNavigationItem = within(sectionNavigation).getByRole('button', { name: 'Node status' });
    expect(statusNavigationItem).toHaveAttribute('aria-current', 'page');
    expect(within(sectionNavigation).getAllByRole('button').map((button) => button.textContent?.trim())).toEqual([
      'Node status',
      'RNode General Config',
      'RNode General Metrics',
    ]);
    expect(within(sectionNavigation).getByRole('button', { name: 'Node status' })
      .querySelector('.provisioning-section-icon')).toHaveAttribute('data-icon', 'info');
    expect(within(sectionNavigation).getByRole('button', { name: 'RNode General Config' })
      .querySelector('.provisioning-section-icon')).toHaveAttribute('data-icon', 'settings');
    expect(within(sectionNavigation).getByRole('button', { name: 'RNode General Metrics' })
      .querySelector('.provisioning-section-icon')).toHaveAttribute('data-icon', 'info');
    const sectionSelect = await screen.findByRole('combobox', { name: 'Provisioning section' }) as HTMLSelectElement;
    expect(sectionSelect).toHaveValue('status');
    expect(Array.from(sectionSelect.options, (option) => option.textContent)).toEqual([
      'Node status',
      'RNode General Config',
      'RNode General Metrics',
    ]);
    expect(screen.getByRole('heading', { name: 'Node status' })).toBeInTheDocument();
    expect(screen.getByText('1.2.3')).toBeInTheDocument();
    expect(screen.queryByText('Device name')).not.toBeInTheDocument();

    await fireEvent.click(within(sectionNavigation).getByRole('button', { name: 'RNode General Config' }));

    expect(sectionSelect).toHaveValue('namespace:10');
    expect(screen.getByRole('group', { name: 'RNode General Config' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Radio' })).toBeInTheDocument();
    expect(screen.getByText('Device name')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Remote Management Allowed' })).toHaveValue('aabb\nccdd');
    expect(screen.queryByText('Uptime')).not.toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Refresh current section' }));

    await waitFor(() => expect(getState).toHaveBeenCalledWith([10, 11], true));
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByDisplayValue('Refreshed node')).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();

    await fireEvent.click(within(sectionNavigation).getByRole('button', { name: 'RNode General Metrics' }));

    expect(sectionSelect).toHaveValue('namespace:20');
    expect(screen.getByRole('group', { name: 'RNode General Metrics' })).toBeInTheDocument();
    expect(screen.getByText('Uptime')).toBeInTheDocument();
    expect(screen.getByText('3600')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'RNode General Metrics' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'RNode General Metrics' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Interfaces' })).toBeInTheDocument();
    const interfaceHeading = screen.getByRole('heading', { level: 3, name: 'LoRaInterface' });
    const interfaceFields = screen.getByRole('group', { name: 'LoRaInterface' });
    expect(interfaceHeading.parentElement).toContainElement(interfaceFields);
    expect(within(interfaceFields).getByText('Frequency')).toBeInTheDocument();
    expect(within(interfaceFields).getByText('869462500')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Interfaces' })).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'RNode General Config' })).not.toBeInTheDocument();
  });

  it('loads committed values and overlays device-side namespace drafts', async () => {
    setProvisioningNodes([announcedNode]);
    vi.spyOn(ProvisioningClient.prototype, 'load').mockResolvedValue({
      info: { needsReboot: false },
      schema: {
        namespaces: [{
          id: 10,
          name: 'Config',
          parentId: 0,
          fields: [{ id: 1, name: 'Name', type: provisioningFieldTypes.string, flags: 0 }, {
            id: 2,
            name: 'Mode',
            type: provisioningFieldTypes.string,
            flags: 0,
          }],
        }],
      },
      state: { 10: { 1: 'Committed name', 2: 'gateway' } },
      drafts: { 10: { 1: 'Pending name' } },
    });
    render(ProvisioningView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(announcedNode.destinationHash) }));

    expect(await screen.findByText('Saved fields pending: 1')).toBeInTheDocument();
    const rebootStatus = screen.getByText('Reboot required').closest('div');
    expect(within(rebootStatus!).getByText('No')).toBeInTheDocument();
    const pendingStatus = screen.getByText('Pending changes').closest('div');
    expect(within(pendingStatus!).getByText('Saved on device: 1')).toBeInTheDocument();
    expect(within(pendingStatus!).getByText('Unsaved in Retivum: 0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Commit all' })).toBeInTheDocument();
    await fireEvent.change(screen.getByRole('combobox', { name: 'Provisioning section' }), {
      target: { value: 'namespace:10' },
    });
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Pending name');
    expect(screen.getByRole('textbox', { name: 'Mode' })).toHaveValue('gateway');
    expect(screen.getByRole('button', { name: 'Revert' })).toBeEnabled();
    await fireEvent.input(screen.getByRole('textbox', { name: 'Mode' }), { target: { value: 'access-point' } });
    await fireEvent.change(screen.getByRole('combobox', { name: 'Provisioning section' }), {
      target: { value: 'status' },
    });
    expect(screen.getByText('Unsaved in Retivum: 1')).toBeInTheDocument();
  });

  it('stages the active namespace before exposing commit-all and discard-all actions', async () => {
    setProvisioningNodes([announcedNode]);
    const load = vi.spyOn(ProvisioningClient.prototype, 'load').mockResolvedValue({
      info: { needsReboot: false },
      schema: {
        namespaces: [{
          id: 10,
          name: 'RNode General Config',
          parentId: 0,
          fields: [{
            id: 1,
            name: 'Device name',
            type: provisioningFieldTypes.string,
            flags: 0,
          }],
        }],
      },
      state: { 10: { 1: 'Original name' } },
    });
    const stage = vi.spyOn(ProvisioningClient.prototype, 'stage').mockResolvedValue({
      applied: 1,
      draftHasReboot: false,
      fieldErrors: [],
    });
    const commit = vi.spyOn(ProvisioningClient.prototype, 'commit').mockResolvedValue({
      applied: 1,
      needsReboot: false,
    });
    const getState = vi.spyOn(ProvisioningClient.prototype, 'getState').mockResolvedValue({
      10: { 1: 'Pending name' },
    });
    const close = vi.spyOn(reticulumRuntime, 'cancelProvisioning').mockImplementation(() => undefined);
    const nativeConfirm = vi.spyOn(window, 'confirm');
    render(ProvisioningView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(announcedNode.destinationHash) }));
    const sectionSelect = await screen.findByRole('combobox', { name: 'Provisioning section' });
    await fireEvent.change(sectionSelect, { target: { value: 'namespace:10' } });

    const saveNamespace = screen.getByRole('button', { name: 'Save namespace' });
    const revert = screen.getByRole('button', { name: 'Revert' });
    const sectionNavigation = screen.getByRole('navigation', { name: 'Provisioning section' });
    const namespaceNavigationItem = within(sectionNavigation).getByRole('button', {
      name: 'RNode General Config',
    });
    const namespaceOption = Array.from((sectionSelect as HTMLSelectElement).options)
      .find((option) => option.value === 'namespace:10');
    const namespaceActions = saveNamespace.parentElement;
    expect(namespaceActions).toHaveClass('provisioning-status-actions', 'provisioning-namespace-actions');
    expect(Array.from(namespaceActions?.children ?? [])).toEqual([revert, saveNamespace]);
    expect(namespaceActions?.previousElementSibling).toContainElement(screen.getByRole('group', {
      name: 'RNode General Config',
    }));
    expect(saveNamespace).toBeDisabled();
    expect(revert).toBeDisabled();
    expect(namespaceNavigationItem.querySelector('.provisioning-section-change-indicator'))
      .not.toBeInTheDocument();
    expect(namespaceOption).toHaveTextContent('RNode General Config');
    expect(namespaceOption).not.toHaveTextContent('•');
    expect(screen.queryByRole('button', { name: 'Commit all' })).not.toBeInTheDocument();

    const deviceName = screen.getByRole('textbox', { name: 'Device name' });
    deviceName.focus();
    await fireEvent.input(deviceName, {
      target: { value: 'Pending name' },
    });

    expect(document.activeElement).toBe(deviceName);
    expect(saveNamespace).toBeEnabled();
    expect(revert).toBeEnabled();
    expect(namespaceNavigationItem).toHaveAttribute('aria-describedby', 'provisioning-section-pending-hint');
    expect(namespaceNavigationItem.querySelector('.provisioning-section-change-indicator'))
      .toBeInTheDocument();
    expect(namespaceOption).toHaveTextContent('RNode General Config •');
    expect(screen.getByText('A dot marks sections with changes that have not been committed.'))
      .toHaveClass('sr-only');
    await fireEvent.input(deviceName, { target: { value: 'Original name' } });
    expect(saveNamespace).toBeDisabled();
    expect(revert).toBeDisabled();
    expect(namespaceNavigationItem.querySelector('.provisioning-section-change-indicator'))
      .not.toBeInTheDocument();
    expect(namespaceOption).not.toHaveTextContent('•');
    await fireEvent.input(deviceName, { target: { value: 'Pending name' } });
    await fireEvent.click(saveNamespace);

    await waitFor(() => expect(stage).toHaveBeenCalledWith({ 10: { 1: 'Pending name' } }));
    expect(load).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Save namespace' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Revert' })).toBeEnabled();
    expect(namespaceNavigationItem.querySelector('.provisioning-section-change-indicator'))
      .toBeInTheDocument();
    expect(namespaceOption).toHaveTextContent('RNode General Config •');
    const pendingBar = screen.getByText('Saved fields pending: 1').closest('.provisioning-pending-bar');
    expect(pendingBar).toBeInTheDocument();
    expect(sectionSelect.nextElementSibling).toBe(pendingBar);
    expect(pendingBar?.parentElement).toBe(sectionSelect.closest('form'));
    expect(screen.getByRole('button', { name: 'Discard all' })).toBeInTheDocument();

    await fireEvent.click(screen.getByRole('button', { name: 'Commit all' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Commit all' });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Commit all' }));

    await waitFor(() => expect(commit).toHaveBeenCalledWith());
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(getState).toHaveBeenCalledWith([10]);
    expect(screen.queryByRole('button', { name: 'Commit all' })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Pending name')).toBeInTheDocument();
    expect(namespaceNavigationItem.querySelector('.provisioning-section-change-indicator'))
      .not.toBeInTheDocument();
    expect(namespaceOption).not.toHaveTextContent('•');
    expect(close).not.toHaveBeenCalled();
  });

  it('validates numeric schema limits immediately and uses tenths for zero-to-one fields', async () => {
    setProvisioningNodes([announcedNode]);
    vi.spyOn(ProvisioningClient.prototype, 'load').mockResolvedValue({
      info: { needsReboot: false },
      schema: {
        namespaces: [{
          id: 10,
          name: 'RNode General Config',
          parentId: 0,
          fields: [{
            id: 1,
            name: 'LT Airtime',
            type: provisioningFieldTypes.float,
            flags: 0,
            minFloat: 0,
            maxFloat: 1,
          }],
        }],
      },
      state: { 10: { 1: 0.2 } },
    });
    const stage = vi.spyOn(ProvisioningClient.prototype, 'stage').mockResolvedValue({
      applied: 1,
      draftHasReboot: false,
      fieldErrors: [],
    });
    render(ProvisioningView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(announcedNode.destinationHash) }));
    await fireEvent.change(await screen.findByRole('combobox', { name: 'Provisioning section' }), {
      target: { value: 'namespace:10' },
    });

    const airtime = screen.getByRole('spinbutton', { name: 'LT Airtime' });
    const saveNamespace = screen.getByRole('button', { name: 'Save namespace' });
    expect(airtime).toHaveAttribute('min', '0');
    expect(airtime).toHaveAttribute('max', '1');
    expect(airtime).toHaveAttribute('step', '0.1');

    await fireEvent.input(airtime, { target: { value: '0.5' } });
    expect(saveNamespace).toBeEnabled();

    await fireEvent.input(airtime, { target: { value: '1.1' } });
    expect(airtime).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Must be at most 1.');
    expect(saveNamespace).toBeDisabled();
    await fireEvent.click(saveNamespace);
    expect(stage).not.toHaveBeenCalled();

    await fireEvent.input(airtime, { target: { value: '0.6' } });
    expect(airtime).not.toHaveAttribute('aria-invalid');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(saveNamespace).toBeEnabled();
    await fireEvent.click(saveNamespace);

    await waitFor(() => expect(stage).toHaveBeenCalledWith({ 10: { 1: 0.6 } }));
  });

  it('includes a remote field rejection in the save failure toast', async () => {
    setProvisioningNodes([announcedNode]);
    vi.spyOn(ProvisioningClient.prototype, 'load').mockResolvedValue({
      info: { needsReboot: false },
      schema: {
        namespaces: [{
          id: 10,
          name: 'RNode General Config',
          parentId: 0,
          fields: [{
            id: 1,
            name: 'LT Airtime',
            type: provisioningFieldTypes.float,
            flags: 0,
            minFloat: 0,
            maxFloat: 1,
          }],
        }],
      },
      state: { 10: { 1: 0.2 } },
    });
    vi.spyOn(ProvisioningClient.prototype, 'stage')
      .mockRejectedValue(new ProvisioningFieldFailure(10, 1, 6));
    render(ProvisioningView);
    render(ToastViewport);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(announcedNode.destinationHash) }));
    await fireEvent.change(await screen.findByRole('combobox', { name: 'Provisioning section' }), {
      target: { value: 'namespace:10' },
    });
    await fireEvent.input(screen.getByRole('spinbutton', { name: 'LT Airtime' }), {
      target: { value: '0.5' },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Save namespace' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The namespace changes could not be saved. Device response: LT Airtime: Constraint not satisfied.',
    );
  });

  it('reverts one namespace tree and can discard every staged namespace', async () => {
    setProvisioningNodes([announcedNode]);
    vi.spyOn(ProvisioningClient.prototype, 'load').mockResolvedValue({
      info: { needsReboot: false },
      schema: {
        namespaces: [{
          id: 10,
          name: 'Config',
          parentId: 0,
          fields: [{ id: 1, name: 'Name', type: provisioningFieldTypes.string, flags: 0 }],
        }, {
          id: 11,
          name: 'Child',
          parentId: 10,
          fields: [],
        }],
      },
      state: { 10: { 1: 'Original' }, 11: {} },
    });
    vi.spyOn(ProvisioningClient.prototype, 'stage').mockResolvedValue({
      applied: 1,
      draftHasReboot: false,
      fieldErrors: [],
    });
    const discard = vi.spyOn(ProvisioningClient.prototype, 'discard').mockResolvedValue();
    const getState = vi.spyOn(ProvisioningClient.prototype, 'getState').mockResolvedValue({
      10: { 1: 'Original' },
      11: {},
    });
    const nativeConfirm = vi.spyOn(window, 'confirm');
    render(ProvisioningView);

    await fireEvent.click(screen.getByRole('button', { name: new RegExp(announcedNode.destinationHash) }));
    await fireEvent.change(await screen.findByRole('combobox', { name: 'Provisioning section' }), {
      target: { value: 'namespace:10' },
    });
    const name = screen.getByRole('textbox', { name: 'Name' });

    await fireEvent.input(name, { target: { value: 'Local edit' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Revert' }));

    await waitFor(() => expect(discard).toHaveBeenCalledWith([10, 11]));
    expect(getState).toHaveBeenCalledWith([10, 11]);
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Original');

    await fireEvent.input(screen.getByRole('textbox', { name: 'Name' }), { target: { value: 'Saved edit' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save namespace' }));
    await screen.findByRole('button', { name: 'Discard all' });
    await fireEvent.click(screen.getByRole('button', { name: 'Discard all' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Discard all' });
    expect(within(dialog).getByText('Discard all pending changes on the device?')).toBeInTheDocument();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Discard all' }));

    await waitFor(() => expect(discard).toHaveBeenCalledWith());
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Discard all' })).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Name' })).toHaveValue('Original');
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

    await waitFor(() => expect(screen.getByText('Currently connected to Workshop router'))
      .toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Remote provisioning' })).toBeInTheDocument();
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
