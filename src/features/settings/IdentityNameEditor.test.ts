import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import IdentityNameEditor from './IdentityNameEditor.svelte';

describe('IdentityNameEditor', () => {
  it('saves a trimmed LXMF display name', async () => {
    const onsave = vi.fn().mockResolvedValue(true);
    const oncancel = vi.fn();
    render(IdentityNameEditor, { currentName: 'Anonymous', onsave, oncancel });

    const input = screen.getByRole('textbox');
    expect(input).toHaveValue('Anonymous');
    await fireEvent.input(input, { target: { value: '  Alice  ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onsave).toHaveBeenCalledWith('Alice'));
    expect(oncancel).toHaveBeenCalledOnce();
  });
});
