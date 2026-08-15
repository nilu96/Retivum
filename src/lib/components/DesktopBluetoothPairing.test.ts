import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import DesktopBluetoothPairing from './DesktopBluetoothPairing.svelte';

describe('DesktopBluetoothPairing', () => {
  it('presents a focused numeric PIN field and submits only validated digits', async () => {
    const onrespond = vi.fn();
    render(DesktopBluetoothPairing, {
      request: {
        requestId: 'pair-1',
        deviceId: 'native-rnode',
        pairingKind: 'providePin',
      },
      onrespond,
    });

    const input = screen.getByRole('textbox', { name: 'Bluetooth PIN' });
    const pair = screen.getByRole('button', { name: 'Pair' });
    expect(input).toHaveFocus();
    expect(pair).toBeDisabled();

    await fireEvent.input(input, { target: { value: '12345' } });
    expect(pair).toBeDisabled();

    await fireEvent.input(input, { target: { value: '12a3-4567890' } });
    expect(input).toHaveValue('123456');
    expect(pair).toBeEnabled();
    await fireEvent.click(pair);

    expect(onrespond).toHaveBeenCalledWith(true, '123456');
  });

  it('gives a confirmation PIN clear visual and accessible prominence', async () => {
    const onrespond = vi.fn();
    render(DesktopBluetoothPairing, {
      request: {
        requestId: 'pair-2',
        deviceId: 'native-rnode',
        pairingKind: 'confirmPin',
        pin: '482913',
      },
      onrespond,
    });

    expect(screen.getByRole('status', { name: 'Bluetooth PIN' })).toHaveTextContent('482913');
    expect(screen.getByText('Used only for this pairing attempt. The PIN is never saved.')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(onrespond).toHaveBeenCalledWith(true, undefined);
  });

  it('ends the current pairing request when the user cancels', async () => {
    const onrespond = vi.fn();
    render(DesktopBluetoothPairing, {
      request: {
        requestId: 'pair-cancelled',
        deviceId: 'native-rnode',
        pairingKind: 'providePin',
      },
      onrespond,
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onrespond).toHaveBeenCalledOnce();
    expect(onrespond).toHaveBeenCalledWith(false);
  });
});
