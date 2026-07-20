import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import InterfaceTypePicker from './InterfaceTypePicker.svelte';

describe('InterfaceTypePicker', () => {
  it('selects WebSocket through the extensible interface-type menu', async () => {
    const onselect = vi.fn();
    render(InterfaceTypePicker, { onselect });

    const addButton = screen.getByRole('button', { name: 'Add interface' });
    expect(addButton).toHaveAttribute('aria-expanded', 'false');
    await fireEvent.click(addButton);

    expect(screen.getByRole('menu', { name: 'Choose interface type' })).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('menuitem', { name: /WebSocket/ }));
    expect(onselect).toHaveBeenCalledWith('websocket');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('only renders the interface types supplied by platform capability detection', async () => {
    render(InterfaceTypePicker, { onselect: vi.fn(), types: ['websocket', 'rnode'] });
    await fireEvent.click(screen.getByRole('button', { name: 'Add interface' }));
    expect(screen.getByRole('menuitem', { name: /WebSocket/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /RNode LoRa/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /^TCP/ })).not.toBeInTheDocument();
  });
});
