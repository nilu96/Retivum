import { cleanup, fireEvent, render, screen, within } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { provisioningFieldFlags, provisioningFieldTypes } from '../../domain/provisioning';
import { createRNodeInterfaceDraft } from '../../domain/settings';
import { LocalProvisioningClient, RNodeMaintenanceSession } from '../../infrastructure/platform/rnode-maintenance';
import { answerDesktopBluetoothSelection } from '../../infrastructure/platform/desktop-bluetooth-selection';
import { interfaceConfigurations, interfaceStatuses, reticulumRuntime } from '../../infrastructure/reticulum/runtime';
import { clearToasts, toasts } from '../../lib/notifications/toasts';
import RNodeMaintenanceView from './RNodeMaintenanceView.svelte';

describe('RNodeMaintenanceView', () => {
  beforeEach(() => {
    clearToasts();
    const config = createRNodeInterfaceDraft('serial', 'configured-rnode');
    config.name = 'Desk RNode';
    config.connection.usbVendorId = 0x10c4;
    config.connection.usbProductId = 0xea60;
    interfaceConfigurations.set([config]);
    interfaceStatuses.set({});
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        getPorts: vi.fn().mockResolvedValue([{
          getInfo: () => ({ usbVendorId: 0x10c4, usbProductId: 0xea60 }),
        }]),
        requestPort: vi.fn(),
      },
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    clearToasts();
    delete (navigator as Navigator & { serial?: Serial }).serial;
    delete (navigator as Navigator & { bluetooth?: Bluetooth }).bluetooth;
    window.retivumDesktopBluetooth = undefined;
    interfaceConfigurations.set([]);
    interfaceStatuses.set({});
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('refreshes serial devices every second while the Device tab is open', async () => {
    vi.useFakeTimers();
    const getPorts = vi.mocked(navigator.serial!.getPorts);
    render(RNodeMaintenanceView);

    await vi.waitFor(() => expect(getPorts).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(getPorts).toHaveBeenCalledTimes(2);

    vi.spyOn(reticulumRuntime, 'claimRNodeInterfaceForMaintenance').mockResolvedValue(true);
    vi.spyOn(RNodeMaintenanceSession.prototype, 'open').mockResolvedValue({ firmwareVersion: '1.73' });
    vi.spyOn(RNodeMaintenanceSession.prototype, 'close').mockResolvedValue();
    vi.spyOn(LocalProvisioningClient.prototype, 'load').mockResolvedValue({
      info: { firmwareVersion: 'microReticulum', schemaVersion: 2, needsReboot: false },
      schema: { namespaces: [] },
      state: {},
    });
    await fireEvent.click(screen.getByText('Desk RNode').closest('button')!);
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Logs' })).toBeEnabled());
    await fireEvent.click(screen.getByRole('button', { name: 'Logs' }));
    const callsAfterLeavingDevice = getPorts.mock.calls.length;

    await vi.advanceTimersByTimeAsync(2_000);
    expect(getPorts).toHaveBeenCalledTimes(callsAfterLeavingDevice);
  });

  it('lists an already-authorized configured serial RNode and keeps the system picker available', async () => {
    render(RNodeMaintenanceView);

    expect(await screen.findByText('Desk RNode')).toBeInTheDocument();
    expect(screen.getByText(/USB 10c4:ea60/)).toHaveTextContent('Configured interface');
    expect(screen.getByRole('button', { name: 'Choose serial device' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Node config' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Extended provisioning' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Logs' })).not.toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'RNode maintenance sections' })).toHaveAttribute('data-tab-count', '1');
    expect(get(toasts)).toEqual([]);
    await fireEvent.click(screen.getByRole('button', { name: 'Refresh devices' }));
    await vi.waitFor(() => expect(get(toasts)).toContainEqual(expect.objectContaining({
      kind: 'success',
      messageKey: 'rnodeMaintenance.device.refreshSuccess',
      parameters: { count: 1 },
    })));
  });

  it('uses a generic serial label when no device name is available', async () => {
    interfaceConfigurations.set([]);
    render(RNodeMaintenanceView);

    expect(await screen.findByText('Serial device')).toBeInTheDocument();
    expect(screen.queryByText('Serial device 1')).not.toBeInTheDocument();
    expect(screen.getByText('USB 10c4:ea60')).toBeInTheDocument();
  });

  it('lists and claims a configured Bluetooth RNode for local maintenance', async () => {
    const config = createRNodeInterfaceDraft('ble', 'configured-ble-rnode');
    config.name = 'Pocket RNode';
    config.connection = { type: 'ble', deviceId: 'ble-device-1', deviceName: 'Pocket RNode' };
    interfaceConfigurations.set([config]);
    interfaceStatuses.set({ [config.id]: 'online' });
    const bluetoothDevice = Object.assign(new EventTarget(), {
      id: 'ble-device-1',
      name: 'Pocket RNode',
    }) as BluetoothDevice;
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: {
        getDevices: vi.fn().mockResolvedValue([bluetoothDevice]),
        requestDevice: vi.fn(),
      },
    });
    const claim = vi.spyOn(reticulumRuntime, 'claimRNodeInterfaceForMaintenance').mockResolvedValue(true);
    vi.spyOn(reticulumRuntime, 'releaseRNodeInterfaceFromMaintenance').mockResolvedValue();
    vi.spyOn(RNodeMaintenanceSession.prototype, 'open').mockResolvedValue({ firmwareVersion: '1.80' });
    vi.spyOn(RNodeMaintenanceSession.prototype, 'close').mockResolvedValue();
    vi.spyOn(LocalProvisioningClient.prototype, 'load').mockRejectedValue(new Error('unsupported'));
    render(RNodeMaintenanceView);

    const deviceName = await screen.findByText('Pocket RNode');
    expect(screen.getByText(/BLE/)).toHaveTextContent('Configured interface');
    expect(screen.getByRole('button', { name: 'Choose Bluetooth device' })).toBeInTheDocument();
    await fireEvent.click(deviceName.closest('button')!);

    await vi.waitFor(() => expect(claim).toHaveBeenCalledWith('configured-ble-rnode'));
    await vi.waitFor(() => expect(get(toasts)).toContainEqual(expect.objectContaining({
      kind: 'success',
      messageKey: 'rnodeMaintenance.connect.success',
      parameters: { name: 'Pocket RNode' },
    })));

    await fireEvent.click(screen.getByRole('button', { name: 'Connected' }));
    const dialog = await screen.findByRole('dialog', { name: 'Connection details' });
    expect(within(dialog).getByText('Bluetooth LE')).toBeInTheDocument();
    expect(within(dialog).getByText('ble-device-1')).toBeInTheDocument();
    expect(within(dialog).getAllByText('Pocket RNode')).toHaveLength(2);
  });

  it('shows serial connection details and disconnects from the connected badge', async () => {
    vi.spyOn(reticulumRuntime, 'claimRNodeInterfaceForMaintenance').mockResolvedValue(true);
    const release = vi.spyOn(reticulumRuntime, 'releaseRNodeInterfaceFromMaintenance').mockResolvedValue();
    vi.spyOn(RNodeMaintenanceSession.prototype, 'open').mockResolvedValue({ firmwareVersion: '1.73' });
    const close = vi.spyOn(RNodeMaintenanceSession.prototype, 'close').mockResolvedValue();
    vi.spyOn(LocalProvisioningClient.prototype, 'load').mockRejectedValue(new Error('unsupported'));
    render(RNodeMaintenanceView);

    await fireEvent.click((await screen.findByText('Desk RNode')).closest('button')!);
    const connectedBadge = await screen.findByRole('button', { name: 'Connected' });
    expect(connectedBadge).toHaveAttribute('title', 'Show connection details');
    await fireEvent.click(connectedBadge);

    const dialog = await screen.findByRole('dialog', { name: 'Connection details' });
    expect(within(dialog).getByText('Serial')).toBeInTheDocument();
    expect(within(dialog).getByText('USB 10c4:ea60')).toBeInTheDocument();
    expect(within(dialog).getByText('Desk RNode')).toBeInTheDocument();
    expect(within(dialog).queryByText('Device name')).not.toBeInTheDocument();
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Disconnect' }));

    await vi.waitFor(() => {
      expect(close).toHaveBeenCalled();
      expect(release).toHaveBeenCalledWith('configured-rnode');
      expect(screen.queryByRole('dialog', { name: 'Connection details' })).not.toBeInTheDocument();
      expect(screen.getByText('Disconnected')).toBeInTheDocument();
    });
  });

  it('hides an authorized Bluetooth RNode that is not currently connected', async () => {
    const config = createRNodeInterfaceDraft('ble', 'offline-ble-rnode');
    config.name = 'Offline RNode';
    config.connection = { type: 'ble', deviceId: 'ble-device-1', deviceName: 'Offline RNode' };
    interfaceConfigurations.set([config]);
    const bluetoothDevice = Object.assign(new EventTarget(), {
      id: 'ble-device-1',
      name: 'Offline RNode',
    }) as BluetoothDevice;
    const getDevices = vi.fn().mockResolvedValue([bluetoothDevice]);
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: {
        getDevices,
        requestDevice: vi.fn(),
      },
    });
    render(RNodeMaintenanceView);

    await vi.waitFor(() => expect(getDevices).toHaveBeenCalled());
    expect(screen.queryByText('Offline RNode')).not.toBeInTheDocument();
    expect(screen.getByText('No connected RNodes are available yet.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose Bluetooth device' })).toBeInTheDocument();
  });

  it('selects and connects a new browser Bluetooth RNode', async () => {
    const bluetoothDevice = Object.assign(new EventTarget(), {
      id: 'new-ble-device',
      name: 'New BLE RNode',
    }) as BluetoothDevice;
    const requestDevice = vi.fn().mockResolvedValue(bluetoothDevice);
    Object.defineProperty(navigator, 'bluetooth', {
      configurable: true,
      value: {
        getDevices: vi.fn().mockResolvedValue([]),
        requestDevice,
      },
    });
    vi.spyOn(RNodeMaintenanceSession.prototype, 'open').mockResolvedValue({ firmwareVersion: '1.80' });
    vi.spyOn(RNodeMaintenanceSession.prototype, 'close').mockResolvedValue();
    vi.spyOn(LocalProvisioningClient.prototype, 'load').mockRejectedValue(new Error('unsupported'));
    render(RNodeMaintenanceView);

    await fireEvent.click(await screen.findByRole('button', { name: 'Choose Bluetooth device' }));

    await vi.waitFor(() => expect(requestDevice).toHaveBeenCalledWith({
      filters: [{ services: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'] }],
      optionalServices: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e'],
    }));
    await vi.waitFor(() => expect(get(toasts)).toContainEqual(expect.objectContaining({
      kind: 'success',
      messageKey: 'rnodeMaintenance.connect.success',
      parameters: { name: 'New BLE RNode' },
    })));
    expect(screen.getByText('New BLE RNode')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await vi.waitFor(() => expect(screen.queryByText('New BLE RNode')).not.toBeInTheDocument());
  });

  it('reports a failed native Bluetooth pairing and allows the device picker to be opened again', async () => {
    let listener: ((event: DesktopBluetoothEvent) => void) | undefined;
    const startScan = vi.fn().mockResolvedValue(undefined);
    window.retivumDesktopBluetooth = {
      startScan,
      stopScan: vi.fn().mockResolvedValue(undefined),
      pair: vi.fn().mockRejectedValue(new Error('RNODE_BLE_PAIRING_FAILED')),
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
      onEvent: vi.fn((next) => {
        listener = next;
        return () => { listener = undefined; };
      }),
    };
    render(RNodeMaintenanceView);

    const chooseBluetooth = await screen.findByRole('button', { name: 'Choose Bluetooth device' });
    await fireEvent.click(chooseBluetooth);
    listener?.({
      type: 'device',
      device: { id: 'native-rnode', name: 'Pocket RNode' },
    });
    await answerDesktopBluetoothSelection('native-rnode');

    await vi.waitFor(() => expect(get(toasts)).toContainEqual(expect.objectContaining({
      kind: 'error',
      messageKey: 'rnodeMaintenance.device.pairingError',
    })));
    expect(chooseBluetooth).toBeEnabled();

    await fireEvent.click(chooseBluetooth);
    await vi.waitFor(() => expect(startScan).toHaveBeenCalledTimes(2));
    await answerDesktopBluetoothSelection();
  });

  it('shows a success toast after connecting to a local serial RNode', async () => {
    vi.spyOn(reticulumRuntime, 'claimRNodeInterfaceForMaintenance').mockResolvedValue(true);
    vi.spyOn(reticulumRuntime, 'releaseRNodeInterfaceFromMaintenance').mockResolvedValue();
    vi.spyOn(RNodeMaintenanceSession.prototype, 'open').mockImplementation(async function (this: RNodeMaintenanceSession) {
      (this as unknown as { onTelemetry(telemetry: Record<string, number | string>): void }).onTelemetry({
        currentRssiDbm: -105,
        noiseFloorDbm: -110,
        radioRxPackets: 0,
        airtimeShortPercent: 0,
        channelLoadLongPercent: 0.27,
        batteryPercent: 96,
        batteryState: 'discharging',
        temperatureCelsius: 25,
      });
      return {
        firmwareVersion: '1.73', platform: 0x70, mcu: 0x71, board: 0x50, eepromBytes: 200,
      };
    });
    vi.spyOn(RNodeMaintenanceSession.prototype, 'close').mockResolvedValue();
    vi.spyOn(LocalProvisioningClient.prototype, 'load').mockRejectedValue(new Error('unsupported'));
    render(RNodeMaintenanceView);

    const deviceName = await screen.findByText('Desk RNode');
    await fireEvent.click(deviceName.closest('button')!);

    await vi.waitFor(() => expect(get(toasts)).toContainEqual(expect.objectContaining({
      kind: 'success',
      messageKey: 'rnodeMaintenance.connect.success',
      parameters: { name: 'Desk RNode' },
    })));
    expect(screen.getByRole('heading', { name: 'Device' })).toBeInTheDocument();
    expect(screen.getByText('nRF52 (0x70)')).toBeInTheDocument();
    expect(screen.getByText('nRF52840 (0x71)')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Radio link' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Channel' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Power' })).not.toBeInTheDocument();
    expect(screen.getByText('96% (discharging)')).toBeInTheDocument();
    expect(screen.getByText('25 °C')).toBeInTheDocument();
    const deviceSection = screen.getByRole('heading', { name: 'Device' }).closest('section')!;
    const deviceLabels = Array.from(deviceSection.querySelectorAll('dt'), (label) => label.textContent);
    expect(deviceLabels.at(-1)).toBe('Reboot required');
    expect(screen.getByText('0.00 %')).toBeInTheDocument();
    expect(screen.queryByText('Last packet RSSI')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Node config' })).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.queryByRole('button', { name: 'Extended provisioning' })).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Logs' })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Node config' }));
    expect(screen.getByRole('heading', { name: 'General RNode configuration' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Radio' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Bluetooth' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Wi-Fi' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Display' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'EEPROM' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Device info' })).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Device' }));
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled());
    await fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    await vi.waitFor(() => expect(get(toasts)).toContainEqual(expect.objectContaining({
      kind: 'success',
      messageKey: 'rnodeMaintenance.device.disconnectSuccess',
      parameters: { name: 'Desk RNode' },
    })));
  });

  it('shows error toasts when refreshing or disconnecting fails', async () => {
    const getPorts = vi.mocked(navigator.serial!.getPorts);
    render(RNodeMaintenanceView);
    await screen.findByText('Desk RNode');
    getPorts.mockRejectedValueOnce(new Error('enumeration failed'));

    await fireEvent.click(screen.getByRole('button', { name: 'Refresh devices' }));
    await vi.waitFor(() => expect(get(toasts)).toContainEqual(expect.objectContaining({
      kind: 'error',
      messageKey: 'rnodeMaintenance.device.refreshError',
    })));

    vi.spyOn(reticulumRuntime, 'claimRNodeInterfaceForMaintenance').mockResolvedValue(true);
    vi.spyOn(reticulumRuntime, 'releaseRNodeInterfaceFromMaintenance').mockRejectedValue(new Error('release failed'));
    vi.spyOn(RNodeMaintenanceSession.prototype, 'open').mockResolvedValue({ firmwareVersion: '1.73' });
    vi.spyOn(RNodeMaintenanceSession.prototype, 'close').mockResolvedValue();
    vi.spyOn(LocalProvisioningClient.prototype, 'load').mockRejectedValue(new Error('unsupported'));
    const deviceName = screen.getByText('Desk RNode');
    await fireEvent.click(deviceName.closest('button')!);
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Disconnect' })).toBeEnabled());
    await fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));

    await vi.waitFor(() => expect(get(toasts)).toContainEqual(expect.objectContaining({
      kind: 'error',
      messageKey: 'rnodeMaintenance.device.disconnectError',
      parameters: { name: 'Desk RNode' },
    })));
  });

  it('shows extended provisioning and logs only after compatible local provisioning succeeds', async () => {
    vi.spyOn(reticulumRuntime, 'claimRNodeInterfaceForMaintenance').mockResolvedValue(true);
    vi.spyOn(reticulumRuntime, 'releaseRNodeInterfaceFromMaintenance').mockResolvedValue();
    vi.spyOn(RNodeMaintenanceSession.prototype, 'open').mockImplementation(async function (this: RNodeMaintenanceSession) {
      (this as unknown as { onLog(message: string): void }).onLog('[INF] device ready\n[DBG] radio state');
      return { firmwareVersion: '1.73' };
    });
    vi.spyOn(RNodeMaintenanceSession.prototype, 'close').mockResolvedValue();
    vi.spyOn(LocalProvisioningClient.prototype, 'load').mockResolvedValue({
      info: { firmwareVersion: 'microReticulum', schemaVersion: 2, needsReboot: false },
      schema: { namespaces: [] },
      state: {},
    });
    render(RNodeMaintenanceView);

    const deviceName = await screen.findByText('Desk RNode');
    await fireEvent.click(deviceName.closest('button')!);

    expect(await screen.findByRole('button', { name: 'Extended provisioning' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Logs' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'RNode maintenance sections' })).toHaveAttribute('data-tab-count', '4');
    expect(screen.queryByRole('heading', { name: 'Radio link' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Channel' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Power' })).not.toBeInTheDocument();
    const deviceRebootStatus = screen.getByText('Reboot required').closest('div');
    expect(within(deviceRebootStatus!).getByText('No')).toHaveClass('badge', 'success');
    await fireEvent.click(screen.getByRole('button', { name: 'Extended provisioning' }));
    const provisioningRebootStatus = screen.getByText('Reboot required').closest('div');
    expect(within(provisioningRebootStatus!).getByText('No')).toHaveClass('badge', 'success');
    await fireEvent.click(screen.getByRole('button', { name: 'Logs' }));
    expect(screen.getByText('[INF] device ready')).toBeInTheDocument();
    expect(screen.getByText('[DBG] radio state')).toBeInTheDocument();
    expect(screen.queryByText('RNODE_MAINTENANCE_CONNECTED')).not.toBeInTheDocument();
  });

  it('uses the shared provisioning fields and saves all local namespace changes in one commit', async () => {
    vi.spyOn(reticulumRuntime, 'claimRNodeInterfaceForMaintenance').mockResolvedValue(true);
    vi.spyOn(reticulumRuntime, 'releaseRNodeInterfaceFromMaintenance').mockResolvedValue();
    vi.spyOn(RNodeMaintenanceSession.prototype, 'open').mockResolvedValue({
      firmwareVersion: '1.73',
      board: 0x50,
    });
    vi.spyOn(RNodeMaintenanceSession.prototype, 'close').mockResolvedValue();
    const load = vi.spyOn(LocalProvisioningClient.prototype, 'load').mockResolvedValue({
      info: { firmwareVersion: 'microReticulum', schemaVersion: 2, needsReboot: false },
      schema: {
        namespaces: [{
          id: 10,
          name: 'General',
          parentId: 0,
          fields: [{ id: 1, name: 'Device name', type: provisioningFieldTypes.string, flags: 0 }, {
            id: 2,
            name: 'Serial number',
            type: provisioningFieldTypes.string,
            flags: provisioningFieldFlags.readOnly,
          }],
        }, {
          id: 11,
          name: 'Display',
          parentId: 10,
          fields: [{
            id: 1,
            name: 'Display timeout',
            type: provisioningFieldTypes.integer,
            flags: 0,
            minInteger: 0,
          }],
        }, {
          id: 20,
          name: 'Wi-Fi',
          parentId: 0,
          fields: [{ id: 1, name: 'SSID', type: provisioningFieldTypes.string, flags: 0 }],
        }],
      },
      state: {
        10: { 1: 'Workshop', 2: 'RNode-01' },
        11: { 1: 30 },
        20: { 1: 'mesh' },
      },
    });
    const save = vi.spyOn(LocalProvisioningClient.prototype, 'save').mockResolvedValue({
      applied: 2,
      needsReboot: true,
    });
    const discard = vi.spyOn(LocalProvisioningClient.prototype, 'discard').mockResolvedValue();
    render(RNodeMaintenanceView);

    await fireEvent.click((await screen.findByText('Desk RNode')).closest('button')!);
    await fireEvent.click(await screen.findByRole('button', { name: 'Extended provisioning' }));

    const generalHeading = screen.getByRole('heading', { level: 2, name: 'General' });
    const displayHeading = screen.getByRole('heading', { level: 2, name: 'Display' });
    const wifiHeading = screen.getByRole('heading', { level: 2, name: 'Wi-Fi' });
    const generalCard = generalHeading.closest('.provisioning-namespace-card');
    expect(generalCard).toContainElement(displayHeading);
    expect(wifiHeading.closest('.provisioning-namespace-card')).not.toBe(generalCard);
    expect(screen.getByText('Generic nRF52 (0x50)')).toBeInTheDocument();
    expect(screen.getByText('RNode-01').closest('label')).toHaveClass('read-only');
    const deviceName = screen.getByRole('textbox', { name: 'Device name' });
    const displayTimeout = screen.getByRole('spinbutton', { name: 'Display timeout' });
    expect(screen.queryByRole('button', { name: 'Revert' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save changes/ })).not.toBeInTheDocument();

    await fireEvent.input(deviceName, { target: { value: 'Field node' } });
    await fireEvent.input(displayTimeout, { target: { value: '45' } });
    const saveChanges = screen.getByRole('button', { name: 'Save changes (2)' });
    const revert = screen.getByRole('button', { name: 'Revert' });
    expect(revert.parentElement).toHaveClass('provisioning-save-actions');
    expect(saveChanges).toBeEnabled();
    expect(revert).toBeEnabled();

    await fireEvent.click(screen.getByRole('button', { name: 'Save changes (2)' }));
    await vi.waitFor(() => expect(save).toHaveBeenCalledWith({
      10: { 1: 'Field node' },
      11: { 1: 45 },
    }, [10, 11]));
    expect(load).toHaveBeenCalledTimes(2);
    expect(get(toasts)).toContainEqual(expect.objectContaining({
      kind: 'success',
      messageKey: 'rnodeMaintenance.provisioning.saveSuccessRebootRequired',
      parameters: { count: 2 },
    }));
    expect(get(toasts).some((entry) => entry.messageKey === 'rnodeMaintenance.provisioning.saveSuccess')).toBe(false);

    await fireEvent.input(screen.getByRole('textbox', { name: 'SSID' }), { target: { value: 'temporary' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Revert' }));
    expect(screen.getByRole('textbox', { name: 'SSID' })).toHaveValue('mesh');
    expect(screen.queryByRole('button', { name: /Save changes/ })).not.toBeInTheDocument();
    expect(discard).not.toHaveBeenCalled();
  });

  it('shows reload feedback only for a manual extended-provisioning refresh', async () => {
    vi.spyOn(reticulumRuntime, 'claimRNodeInterfaceForMaintenance').mockResolvedValue(true);
    vi.spyOn(reticulumRuntime, 'releaseRNodeInterfaceFromMaintenance').mockResolvedValue();
    vi.spyOn(RNodeMaintenanceSession.prototype, 'open').mockResolvedValue({ firmwareVersion: '1.73' });
    vi.spyOn(RNodeMaintenanceSession.prototype, 'close').mockResolvedValue();
    const load = vi.spyOn(LocalProvisioningClient.prototype, 'load').mockResolvedValue({
      info: { firmwareVersion: 'microReticulum', schemaVersion: 2, needsReboot: false },
      schema: { namespaces: [] },
      state: {},
    });
    render(RNodeMaintenanceView);

    await fireEvent.click((await screen.findByText('Desk RNode')).closest('button')!);
    await fireEvent.click(await screen.findByRole('button', { name: 'Extended provisioning' }));
    expect(get(toasts).some((entry) => entry.messageKey === 'rnodeMaintenance.provisioning.reloadSuccess')).toBe(false);

    await fireEvent.click(screen.getByRole('button', { name: 'Reload settings' }));
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(get(toasts)).toContainEqual(expect.objectContaining({
      kind: 'success',
      messageKey: 'rnodeMaintenance.provisioning.reloadSuccess',
    }));

    load.mockRejectedValueOnce(new Error('reload failed'));
    await fireEvent.click(screen.getByRole('button', { name: 'Reload settings' }));
    await vi.waitFor(() => expect(get(toasts)).toContainEqual(expect.objectContaining({
      kind: 'error',
      messageKey: 'rnodeMaintenance.provisioning.reloadError',
    })));
  });

  it('offers the standard RNode reboot action without exposing an unsupported factory reset', async () => {
    vi.spyOn(reticulumRuntime, 'claimRNodeInterfaceForMaintenance').mockResolvedValue(true);
    const release = vi.spyOn(reticulumRuntime, 'releaseRNodeInterfaceFromMaintenance').mockResolvedValue();
    vi.spyOn(RNodeMaintenanceSession.prototype, 'open').mockResolvedValue({ firmwareVersion: '1.73' });
    vi.spyOn(RNodeMaintenanceSession.prototype, 'close').mockResolvedValue();
    const reboot = vi.spyOn(RNodeMaintenanceSession.prototype, 'reboot').mockResolvedValue();
    vi.spyOn(LocalProvisioningClient.prototype, 'load').mockRejectedValue(new Error('unsupported'));
    render(RNodeMaintenanceView);

    await fireEvent.click((await screen.findByText('Desk RNode')).closest('button')!);
    const rebootButton = await screen.findByRole('button', { name: 'Reboot device' });
    expect(screen.queryByRole('button', { name: 'Factory reset' })).not.toBeInTheDocument();
    await fireEvent.click(rebootButton);
    const dialog = await screen.findByRole('alertdialog', { name: 'Reboot device' });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Reboot device' }));

    await vi.waitFor(() => expect(reboot).toHaveBeenCalledOnce());
    await vi.waitFor(() => {
      expect(release).toHaveBeenCalledWith('configured-rnode');
      expect(screen.getByText('Disconnected')).toBeInTheDocument();
      expect(get(toasts)).toContainEqual(expect.objectContaining({
        kind: 'success',
        messageKey: 'provisioning.reboot.sent',
      }));
    });
  });

  it('offers provisioning factory reset only for compatible local firmware', async () => {
    vi.spyOn(reticulumRuntime, 'claimRNodeInterfaceForMaintenance').mockResolvedValue(true);
    vi.spyOn(reticulumRuntime, 'releaseRNodeInterfaceFromMaintenance').mockResolvedValue();
    vi.spyOn(RNodeMaintenanceSession.prototype, 'open').mockResolvedValue({ firmwareVersion: '1.73' });
    vi.spyOn(RNodeMaintenanceSession.prototype, 'close').mockResolvedValue();
    vi.spyOn(LocalProvisioningClient.prototype, 'load').mockResolvedValue({
      info: { firmwareVersion: 'microReticulum', schemaVersion: 2, needsReboot: false },
      schema: { namespaces: [] },
      state: {},
    });
    const factoryReset = vi.spyOn(LocalProvisioningClient.prototype, 'factoryReset').mockResolvedValue();
    render(RNodeMaintenanceView);

    await fireEvent.click((await screen.findByText('Desk RNode')).closest('button')!);
    const factoryResetButton = await screen.findByRole('button', { name: 'Factory reset' });
    await fireEvent.click(factoryResetButton);
    const dialog = await screen.findByRole('alertdialog', { name: 'Factory reset' });
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Factory reset' }));

    await vi.waitFor(() => expect(factoryReset).toHaveBeenCalledOnce());
    expect(get(toasts)).toContainEqual(expect.objectContaining({
      kind: 'success',
      messageKey: 'provisioning.factoryReset.sent',
    }));
  });

  it('shows an error toast when connecting to a local serial RNode fails', async () => {
    vi.spyOn(reticulumRuntime, 'claimRNodeInterfaceForMaintenance').mockResolvedValue(true);
    vi.spyOn(reticulumRuntime, 'releaseRNodeInterfaceFromMaintenance').mockResolvedValue();
    vi.spyOn(RNodeMaintenanceSession.prototype, 'open').mockRejectedValue(new Error('RNODE_MAINTENANCE_TIMEOUT'));
    vi.spyOn(RNodeMaintenanceSession.prototype, 'close').mockResolvedValue();
    render(RNodeMaintenanceView);

    const deviceName = await screen.findByText('Desk RNode');
    await fireEvent.click(deviceName.closest('button')!);

    await vi.waitFor(() => expect(get(toasts)).toContainEqual(expect.objectContaining({
      kind: 'error',
      messageKey: 'rnodeMaintenance.connect.error',
      parameters: { name: 'Desk RNode' },
    })));
    await vi.waitFor(() => expect(deviceName.closest('button')).not.toHaveClass('selected'));
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument();
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
    expect(screen.queryByText('Action failed')).not.toBeInTheDocument();
  });

});
