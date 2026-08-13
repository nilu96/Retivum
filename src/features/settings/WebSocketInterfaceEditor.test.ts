import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import { createWebSocketInterfaceDraft } from '../../domain/settings';
import WebSocketInterfaceEditor from './WebSocketInterfaceEditor.svelte';

describe('WebSocketInterfaceEditor', () => {
  it('renames an existing interface without replacing its identity', async () => {
    const config = createWebSocketInterfaceDraft('relay-1');
    config.name = 'Old relay name';
    const onsave = vi.fn();
    render(WebSocketInterfaceEditor, { config, oncancel: vi.fn(), onsave });

    expect(screen.queryByText('Reconnect automatically')).not.toBeInTheDocument();
    const name = screen.getByLabelText('Name');
    expect(name).toHaveValue('Old relay name');
    await fireEvent.input(name, { target: { value: 'Renamed relay' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onsave).toHaveBeenCalledWith(expect.objectContaining({ id: 'relay-1', name: 'Renamed relay' }));
  });

  it('keeps advanced interface mode settings collapsed and persists a selected mode', async () => {
    const config = createWebSocketInterfaceDraft('relay-mode');
    config.name = 'Mode relay';
    const onsave = vi.fn();
    render(WebSocketInterfaceEditor, { config, oncancel: vi.fn(), onsave });

    expect(screen.queryByLabelText('Interface mode')).not.toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Show advanced settings' }));
    expect(screen.getByRole('button', { name: 'Hide advanced settings' })).toHaveAttribute('aria-expanded', 'true');

    await fireEvent.change(screen.getByRole('combobox', { name: /Interface mode/ }), { target: { value: 'gateway' } });
    await fireEvent.click(screen.getByRole('switch', { name: /Announce after reconnecting/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onsave).toHaveBeenCalledWith(expect.objectContaining({
      id: 'relay-mode',
      mode: 'gateway',
      reannounceOnReconnect: false,
    }));
  });

  it('shows an empty optional IFAC size and saves an explicit override', async () => {
    const config = createWebSocketInterfaceDraft('relay-ifac');
    config.name = 'IFAC relay';
    const onsave = vi.fn();
    render(WebSocketInterfaceEditor, { config, oncancel: vi.fn(), onsave });

    await fireEvent.click(screen.getByRole('button', { name: 'Show advanced settings' }));
    expect(screen.getByText('Interface access control (IFAC)')).toBeInTheDocument();
    const passphraseInput = screen.getByLabelText('IFAC passphrase');
    const revealButton = screen.getByRole('button', { name: 'Show IFAC passphrase' });
    const sizeInput = screen.getByRole('spinbutton', { name: 'IFAC size (bytes)' });
    expect(sizeInput).toHaveValue(null);
    expect(sizeInput).toHaveAttribute('min', '1');
    expect(sizeInput).toHaveAttribute('max', '64');
    expect(passphraseInput.closest('label')).toBeNull();
    expect(revealButton.closest('label')).toBeNull();
    expect(passphraseInput).toHaveAttribute('autocomplete', 'off');
    expect(passphraseInput).toHaveAttribute('data-1p-ignore', 'true');
    expect(passphraseInput).toHaveAttribute('data-op-ignore', 'true');
    expect(passphraseInput).toHaveAttribute('data-bwignore', 'true');
    expect(passphraseInput).toHaveAttribute('data-lpignore', 'true');
    expect(passphraseInput).toHaveAttribute('data-form-type', 'other');
    expect(passphraseInput).toHaveAttribute('data-protonpass-ignore', 'true');
    await fireEvent.input(screen.getByLabelText('IFAC network name'), { target: { value: 'field-net' } });
    await fireEvent.input(passphraseInput, { target: { value: 'secret phrase' } });
    await fireEvent.input(sizeInput, { target: { value: '31' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onsave).toHaveBeenCalledWith(expect.objectContaining({
      ifac: expect.objectContaining({
        networkName: 'field-net',
        passphrase: 'secret phrase',
        sizeBytes: 31,
      }),
    }));
  });

  it('keeps a cleared IFAC size omitted when saving', async () => {
    const config = createWebSocketInterfaceDraft('relay-cleared-ifac-size');
    config.name = 'IFAC relay';
    config.ifac.sizeBytes = 31;
    const onsave = vi.fn();
    render(WebSocketInterfaceEditor, { config, oncancel: vi.fn(), onsave });

    await fireEvent.click(screen.getByRole('button', { name: 'Show advanced settings' }));
    const sizeInput = screen.getByRole('spinbutton', { name: 'IFAC size (bytes)' });
    expect(sizeInput).toHaveValue(31);
    await fireEvent.input(sizeInput, { target: { value: '' } });
    expect(sizeInput).toHaveValue(null);
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onsave.mock.calls[0]?.[0].ifac).not.toHaveProperty('sizeBytes');
  });
});
