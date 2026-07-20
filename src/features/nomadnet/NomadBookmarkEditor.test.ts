import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';
import NomadBookmarkEditor from './NomadBookmarkEditor.svelte';

describe('NomadBookmarkEditor', () => {
  it('saves a trimmed optional local bookmark name', async () => {
    const onsave = vi.fn().mockResolvedValue(true);
    const oncancel = vi.fn();
    render(NomadBookmarkEditor, {
      address: `${'a'.repeat(32)}:/start`,
      currentName: 'Node',
      currentIdentifyBeforeLoad: false,
      mode: 'edit',
      onsave,
      oncancel,
    });

    const input = screen.getByRole('textbox', { name: 'Bookmark name' });
    expect(input).toHaveValue('Node');
    await fireEvent.input(input, { target: { value: '  Community node  ' } });
    await fireEvent.click(screen.getByRole('switch', { name: /Identify before loading/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onsave).toHaveBeenCalledWith('Community node', true));
    expect(oncancel).toHaveBeenCalledOnce();
  });
});
