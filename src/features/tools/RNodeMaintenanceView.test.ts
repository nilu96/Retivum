import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRNodeInterfaceDraft } from '../../domain/settings';
import { LocalProvisioningClient, RNodeMaintenanceSession } from '../../infrastructure/platform/rnode-maintenance';
import { interfaceConfigurations, reticulumRuntime } from '../../infrastructure/reticulum/runtime';
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
    interfaceConfigurations.set([]);
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

  it('offers to scroll the complete view back to the top', async () => {
    const main = document.createElement('main');
    const scrollTo = vi.fn((options?: ScrollToOptions) => {
      if (typeof options?.top === 'number') main.scrollTop = options.top;
    });
    Object.defineProperty(main, 'scrollTo', { configurable: true, value: scrollTo });
    document.body.append(main);
    render(RNodeMaintenanceView, { target: main });
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
    main.remove();
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

  it('lists and claims a configured Bluetooth RNode for local maintenance', async () => {
    const config = createRNodeInterfaceDraft('ble', 'configured-ble-rnode');
    config.name = 'Pocket RNode';
    config.connection = { type: 'ble', deviceId: 'ble-device-1', deviceName: 'Pocket RNode' };
    interfaceConfigurations.set([config]);
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
    await fireEvent.click(screen.getByRole('button', { name: 'Logs' }));
    expect(screen.getByText('[INF] device ready')).toBeInTheDocument();
    expect(screen.getByText('[DBG] radio state')).toBeInTheDocument();
    expect(screen.queryByText('RNODE_MAINTENANCE_CONNECTED')).not.toBeInTheDocument();
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
