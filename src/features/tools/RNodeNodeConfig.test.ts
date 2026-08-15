import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RNodeMaintenanceSession } from '../../infrastructure/platform/rnode-maintenance';
import { clearToasts, toasts } from '../../lib/notifications/toasts';
import RNodeNodeConfig from './RNodeNodeConfig.svelte';

afterEach(() => {
  cleanup();
  clearToasts();
});

describe('RNodeNodeConfig', () => {
  it('starts set-only Wi-Fi and display settings with empty fields', () => {
    const session = {
      readRadioConfig: vi.fn().mockResolvedValue({
        bootMode: 'host',
        frequency: 869_525_000,
        bandwidth: 125_000,
        spreadingFactor: 8,
        codingRate: 5,
        txPower: 17,
        interferenceAvoidance: true,
      }),
      readEeprom: vi.fn().mockResolvedValue(new Uint8Array(200)),
    } as unknown as RNodeMaintenanceSession;
    render(RNodeNodeConfig, { session });

    for (const label of [
      'Mode',
      'Channel',
      'SSID',
      'PSK',
      'Static IP (0.0.0.0 = DHCP)',
      'Netmask',
      'Display intensity',
      'Blanking timeout (seconds, 0 = off)',
      'Rotation',
      'I²C address',
      'NeoPixel intensity',
    ]) {
      expect((screen.getByLabelText(label) as HTMLInputElement | HTMLSelectElement).value).toBe('');
    }
    expect(screen.getByRole('button', { name: 'Save Wi-Fi' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save display' })).toBeDisabled();
  });

  it('saves one display setting without requiring the other set-only values', async () => {
    const saveDisplayConfig = vi.fn().mockResolvedValue(undefined);
    const session = {
      readRadioConfig: vi.fn().mockResolvedValue({
        bootMode: 'host',
        frequency: 869_525_000,
        bandwidth: 125_000,
        spreadingFactor: 8,
        codingRate: 5,
        txPower: 17,
        interferenceAvoidance: true,
      }),
      readEeprom: vi.fn().mockResolvedValue(new Uint8Array(200)),
      saveDisplayConfig,
    } as unknown as RNodeMaintenanceSession;
    render(RNodeNodeConfig, { session });

    await fireEvent.input(screen.getByLabelText('Blanking timeout (seconds, 0 = off)'), {
      target: { value: '30' },
    });
    const save = screen.getByRole('button', { name: 'Save display' });
    await waitFor(() => expect(save).toBeEnabled());
    await fireEvent.click(save);

    await waitFor(() => expect(saveDisplayConfig).toHaveBeenCalledWith({ blankingTimeout: 30 }));
    expect(get(toasts).at(-1)).toMatchObject({
      kind: 'success',
      messageKey: 'rnodeMaintenance.nodeConfig.displaySaved',
    });
  });

  it('saves one Wi-Fi setting without transmitting untouched values', async () => {
    const saveWifiConfig = vi.fn().mockResolvedValue(undefined);
    const session = {
      readRadioConfig: vi.fn().mockResolvedValue({
        bootMode: 'host',
        frequency: 869_525_000,
        bandwidth: 125_000,
        spreadingFactor: 8,
        codingRate: 5,
        txPower: 17,
        interferenceAvoidance: true,
      }),
      readEeprom: vi.fn().mockResolvedValue(new Uint8Array(200)),
      saveWifiConfig,
    } as unknown as RNodeMaintenanceSession;
    render(RNodeNodeConfig, { session });

    await fireEvent.input(screen.getByLabelText('SSID'), { target: { value: 'field-node' } });
    const save = screen.getByRole('button', { name: 'Save Wi-Fi' });
    await waitFor(() => expect(save).toBeEnabled());
    await fireEvent.click(save);

    await waitFor(() => expect(saveWifiConfig).toHaveBeenCalledWith({ ssid: 'field-node' }));
  });

  it('confirms and restores a selected EEPROM backup file', async () => {
    const current = new Uint8Array(200);
    const backup = Uint8Array.from({ length: 200 }, (_value, index) => index);
    const restoreEeprom = vi.fn().mockResolvedValue(backup);
    const session = {
      readRadioConfig: vi.fn().mockResolvedValue({
        bootMode: 'host',
        frequency: 869_525_000,
        bandwidth: 125_000,
        spreadingFactor: 8,
        codingRate: 5,
        txPower: 17,
        interferenceAvoidance: true,
      }),
      readEeprom: vi.fn().mockResolvedValue(current),
      restoreEeprom,
    } as unknown as RNodeMaintenanceSession;
    render(RNodeNodeConfig, { session });
    const file = new File([backup], 'desk-rnode-eeprom.bin', { type: 'application/octet-stream' });
    Object.defineProperty(file, 'arrayBuffer', {
      value: vi.fn().mockResolvedValue(backup.buffer.slice(0)),
    });

    await fireEvent.change(screen.getByLabelText('EEPROM backup file'), { target: { files: [file] } });

    expect(await screen.findByRole('alertdialog')).toHaveTextContent('desk-rnode-eeprom.bin');
    await fireEvent.click(screen.getByRole('button', { name: 'Restore EEPROM' }));

    await waitFor(() => expect(restoreEeprom).toHaveBeenCalledOnce());
    expect(restoreEeprom).toHaveBeenCalledWith(backup);
    expect(get(toasts).at(-1)).toMatchObject({
      kind: 'success',
      messageKey: 'rnodeMaintenance.nodeConfig.eepromRestored',
    });
    expect(screen.queryByText('EEPROM backup restored and verified. Reboot the RNode to apply it.')).not.toBeInTheDocument();
  });

  it('toasts radio refresh only when manually requested and shows only EEPROM action buttons', async () => {
    const session = {
      readRadioConfig: vi.fn().mockResolvedValue({
        bootMode: 'host',
        frequency: 869_525_000,
        bandwidth: 125_000,
        spreadingFactor: 8,
        codingRate: 5,
        txPower: 17,
        interferenceAvoidance: true,
      }),
      readEeprom: vi.fn().mockResolvedValue(new Uint8Array(200)),
    } as unknown as RNodeMaintenanceSession;
    const { container } = render(RNodeNodeConfig, { session });

    await waitFor(() => expect(session.readRadioConfig).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
    const eepromSection = screen.getByRole('heading', { name: 'EEPROM' }).closest('section')!;
    expect(within(eepromSection).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Back up to file',
      'Restore from file',
      'Wipe EEPROM',
    ]);
    expect(container.querySelector('.rnode-eeprom-hex')).not.toBeInTheDocument();
    expect(get(toasts)).not.toContainEqual(expect.objectContaining({
      messageKey: 'rnodeMaintenance.nodeConfig.radioLoaded',
    }));

    await fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(get(toasts)).toContainEqual(expect.objectContaining({
      kind: 'success',
      messageKey: 'rnodeMaintenance.nodeConfig.radioLoaded',
    })));
    expect(screen.queryByText('Radio configuration refreshed.')).not.toBeInTheDocument();
  });
});
