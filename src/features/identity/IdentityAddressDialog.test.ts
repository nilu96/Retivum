import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import IdentityAddressDialog from './IdentityAddressDialog.svelte';

vi.mock('qrcode', () => ({
  default: {
    toCanvas: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('IdentityAddressDialog', () => {
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  afterEach(() => {
    vi.restoreAllMocks();
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('copies the destination hash and LXMA address from their value rows', async () => {
    const destinationHash = 'a'.repeat(32);
    const address = `lxma://${destinationHash}:${'b'.repeat(128)}`;
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    render(IdentityAddressDialog, {
      address,
      destinationHash,
      onclose: vi.fn(),
    });

    await fireEvent.click(screen.getByRole('button', { name: 'Copy LXMF destination hash' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(destinationHash));

    await fireEvent.click(screen.getByRole('button', { name: 'Copy LXMF address' }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(address));

    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
  });
});
