import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import BlockedDestinationsEditor from './BlockedDestinationsEditor.svelte';

describe('BlockedDestinationsEditor', () => {
  it('does not show an error before the user interacts with the field', () => {
    render(BlockedDestinationsEditor, { onsave: vi.fn(), oncancel: vi.fn() });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /Destination hashes/ })).toHaveAttribute(
      'aria-invalid',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Block destinations' })).toBeDisabled();
  });

  it('normalizes and saves a single destination hash', async () => {
    const onsave = vi.fn().mockResolvedValue(true);
    const oncancel = vi.fn();
    render(BlockedDestinationsEditor, { onsave, oncancel });

    await fireEvent.input(screen.getByRole('textbox', { name: /Destination hashes/ }), {
      target: { value: `  ${'A'.repeat(32)}  ` },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Block destinations' }));

    await waitFor(() => expect(onsave).toHaveBeenCalledWith(['a'.repeat(32)]));
    expect(oncancel).toHaveBeenCalledOnce();
  });

  it('accepts multiple lines while ignoring blanks and duplicate hashes', async () => {
    const onsave = vi.fn().mockResolvedValue(true);
    render(BlockedDestinationsEditor, { onsave, oncancel: vi.fn() });
    const firstHash = '1'.repeat(32);
    const secondHash = '2'.repeat(32);

    await fireEvent.input(screen.getByRole('textbox', { name: /Destination hashes/ }), {
      target: { value: `${firstHash}\n\n${secondHash}\n${firstHash}` },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Block destinations' }));

    await waitFor(() => expect(onsave).toHaveBeenCalledWith([firstHash, secondHash]));
  });

  it('rejects the complete input when any non-empty line is invalid', async () => {
    const onsave = vi.fn();
    render(BlockedDestinationsEditor, { onsave, oncancel: vi.fn() });

    await fireEvent.input(screen.getByRole('textbox', { name: /Destination hashes/ }), {
      target: { value: `${'3'.repeat(32)}\nnot-a-destination` },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Each non-empty line must contain one 32-character hexadecimal destination hash.',
    );
    expect(screen.getByRole('button', { name: 'Block destinations' })).toBeDisabled();
    expect(onsave).not.toHaveBeenCalled();
  });

  it('stays open when blocking fails so the input can be retried', async () => {
    const onsave = vi.fn().mockResolvedValue(false);
    const oncancel = vi.fn();
    render(BlockedDestinationsEditor, { onsave, oncancel });

    await fireEvent.input(screen.getByRole('textbox', { name: /Destination hashes/ }), {
      target: { value: '4'.repeat(32) },
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Block destinations' }));

    await waitFor(() => expect(onsave).toHaveBeenCalledOnce());
    expect(oncancel).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Add blocked destinations' })).toBeInTheDocument();
  });
});
