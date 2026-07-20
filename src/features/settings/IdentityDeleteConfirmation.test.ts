import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import IdentityDeleteConfirmation from './IdentityDeleteConfirmation.svelte';

describe('IdentityDeleteConfirmation', () => {
  it('requires explicit confirmation before deleting an identity', async () => {
    const onconfirm = vi.fn().mockResolvedValue(undefined);
    const oncancel = vi.fn();
    render(IdentityDeleteConfirmation, { identityName: 'Alice', onconfirm, oncancel });

    expect(screen.getByRole('alertdialog')).toHaveTextContent('Delete identity “Alice”? This cannot be undone.');
    expect(onconfirm).not.toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'Delete identity' }));
    await waitFor(() => expect(onconfirm).toHaveBeenCalledOnce());
  });

  it('can be cancelled without deleting', async () => {
    const onconfirm = vi.fn().mockResolvedValue(undefined);
    const oncancel = vi.fn();
    render(IdentityDeleteConfirmation, { identityName: 'Alice', onconfirm, oncancel });

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(oncancel).toHaveBeenCalledOnce();
    expect(onconfirm).not.toHaveBeenCalled();
  });
});
