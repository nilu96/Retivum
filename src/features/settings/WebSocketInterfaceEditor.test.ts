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
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(onsave).toHaveBeenCalledWith(expect.objectContaining({ id: 'relay-mode', mode: 'gateway' }));
  });
});
