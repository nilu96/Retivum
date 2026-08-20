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
  it('shows live radio-save activity and resolves it in place to success', async () => {
    let finishSave = () => {};
    const saveRadioConfig = vi.fn().mockReturnValue(new Promise<void>((resolve) => {
      finishSave = resolve;
    }));
    const session = {
      readRadioConfig: vi.fn().mockResolvedValue({
        bootMode: 'tnc',
        frequency: 869_525_000,
        bandwidth: 125_000,
        spreadingFactor: 8,
        codingRate: 5,
        txPower: 17,
        interferenceAvoidance: true,
      }),
      readEeprom: vi.fn().mockResolvedValue(new Uint8Array(200)),
      saveRadioConfig,
    } as unknown as RNodeMaintenanceSession;
    render(RNodeNodeConfig, { session });

    await fireEvent.click(await screen.findByRole('button', { name: 'Save radio' }));

    const savingToast = get(toasts).find((item) => (
      item.messageKey === 'rnodeMaintenance.nodeConfig.radioSaving'
    ));
    expect(savingToast).toEqual(expect.objectContaining({ kind: 'activity' }));

    finishSave();

    await waitFor(() => expect(get(toasts).find((item) => item.id === savingToast!.id)).toEqual(expect.objectContaining({
      kind: 'success',
      messageKey: 'rnodeMaintenance.nodeConfig.radioSaved',
    })));
  });

  it('resolves live radio-save activity in place to an error', async () => {
    let failSave = () => {};
    const saveRadioConfig = vi.fn().mockReturnValue(new Promise<void>((_resolve, reject) => {
      failSave = () => reject(new Error('RNODE_CONFIG_TX_POWER_SAVE_VERIFICATION_FAILED'));
    }));
    const session = {
      readRadioConfig: vi.fn().mockResolvedValue({
        bootMode: 'tnc',
        frequency: 869_525_000,
        bandwidth: 125_000,
        spreadingFactor: 8,
        codingRate: 5,
        txPower: 17,
        interferenceAvoidance: true,
      }),
      readEeprom: vi.fn().mockResolvedValue(new Uint8Array(200)),
      saveRadioConfig,
    } as unknown as RNodeMaintenanceSession;
    render(RNodeNodeConfig, { session });

    await fireEvent.click(await screen.findByRole('button', { name: 'Save radio' }));
    const savingToast = get(toasts).find((item) => (
      item.messageKey === 'rnodeMaintenance.nodeConfig.radioSaving'
    ));
    expect(savingToast).toEqual(expect.objectContaining({ kind: 'activity' }));

    failSave();

    await waitFor(() => expect(get(toasts).find((item) => item.id === savingToast!.id)).toEqual(expect.objectContaining({
      kind: 'error',
      messageKey: 'rnodeMaintenance.nodeConfig.actionFailed',
    })));
  });

  it('uses the native confirmation dialog before saving a boot-mode change', async () => {
    const saveRadioConfig = vi.fn().mockResolvedValue(undefined);
    const browserConfirm = vi.spyOn(globalThis, 'confirm');
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
      saveRadioConfig,
    } as unknown as RNodeMaintenanceSession;
    render(RNodeNodeConfig, { session });

    const bootMode = await screen.findByLabelText('Boot mode');
    expect(screen.getByRole('spinbutton', { name: /Frequency/ })).toHaveAttribute('min', '100000000');
    expect(screen.getByRole('spinbutton', { name: /Frequency/ })).toHaveAttribute('max', '1100000000');
    expect(screen.getByRole('spinbutton', { name: /Bandwidth/ })).toHaveAttribute('max', '500000');
    expect(screen.getByRole('spinbutton', { name: /TX power/ })).toHaveAttribute('min', '0');
    expect(screen.getByRole('spinbutton', { name: /TX power/ })).toHaveAttribute('max', '22');
    await fireEvent.change(bootMode, { target: { value: 'tnc' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save radio' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Switch the RNode to TNC mode on its next boot?');
    expect(saveRadioConfig).not.toHaveBeenCalled();
    expect(browserConfirm).not.toHaveBeenCalled();

    await fireEvent.click(within(dialog).getByRole('button', { name: 'Save radio' }));

    await waitFor(() => expect(saveRadioConfig).toHaveBeenCalledOnce());
    expect(saveRadioConfig).toHaveBeenCalledWith(expect.objectContaining({ bootMode: 'tnc' }));
  });

  it('identifies incomplete HOST-mode defaults before saving a complete TNC profile', async () => {
    const saveRadioConfig = vi.fn().mockResolvedValue(undefined);
    const session = {
      readRadioConfig: vi.fn().mockResolvedValue({
        bootMode: 'host',
        frequency: 0,
        bandwidth: 0,
        spreadingFactor: 0,
        codingRate: 5,
        txPower: 255,
        interferenceAvoidance: true,
      }),
      readEeprom: vi.fn().mockResolvedValue(new Uint8Array(200)),
      saveRadioConfig,
    } as unknown as RNodeMaintenanceSession;
    render(RNodeNodeConfig, { session });

    await fireEvent.change(await screen.findByLabelText('Boot mode'), { target: { value: 'tnc' } });

    expect(screen.getByText('Frequency must be between 100,000,000 and 1,100,000,000 Hz.')).toBeInTheDocument();
    expect(screen.getByText('Bandwidth must be between 7,800 and 500,000 Hz.')).toBeInTheDocument();
    expect(screen.getByText('Spreading factor must be between 5 and 12.')).toBeInTheDocument();
    expect(screen.getByText('TX power must be between 0 and 22 dBm.')).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: /TX power/ }).closest('label'))
      .toHaveTextContent('TX power must be between 0 and 22 dBm.');
    expect(screen.getByText(/Delays transmission while supported RNodes detect interference/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save radio' })).toBeDisabled();

    await fireEvent.input(screen.getByRole('spinbutton', { name: /Frequency/ }), { target: { value: '869525000' } });
    await fireEvent.input(screen.getByRole('spinbutton', { name: /Bandwidth/ }), { target: { value: '125000' } });
    await fireEvent.input(screen.getByRole('spinbutton', { name: /Spreading factor/ }), { target: { value: '8' } });
    await fireEvent.input(screen.getByRole('spinbutton', { name: /TX power/ }), { target: { value: '17' } });

    const save = screen.getByRole('button', { name: 'Save radio' });
    await waitFor(() => expect(save).toBeEnabled());
    await fireEvent.click(save);
    await fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Save radio' }));

    await waitFor(() => expect(saveRadioConfig).toHaveBeenCalledWith({
      bootMode: 'tnc',
      frequency: 869_525_000,
      bandwidth: 125_000,
      spreadingFactor: 8,
      codingRate: 5,
      txPower: 17,
      interferenceAvoidance: true,
    }));
  });

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

  it('marks every Wi-Fi setting for password managers to ignore', async () => {
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

    await screen.findByLabelText('Boot mode');
    for (const label of [
      'Mode',
      'Channel',
      'SSID',
      'PSK',
      'Static IP (0.0.0.0 = DHCP)',
      'Netmask',
    ]) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveAttribute('autocomplete', 'off');
      expect(field).toHaveAttribute('data-1p-ignore', 'true');
      expect(field).toHaveAttribute('data-op-ignore', 'true');
      expect(field).toHaveAttribute('data-bwignore', 'true');
      expect(field).toHaveAttribute('data-lpignore', 'true');
      expect(field).toHaveAttribute('data-form-type', 'other');
      expect(field).toHaveAttribute('data-protonpass-ignore', 'true');
    }
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
