import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import NomadBookmarkEditor from './NomadBookmarkEditor.svelte';

describe('NomadBookmarkEditor', () => {
  let clipboardDescriptor: PropertyDescriptor | undefined;

  afterEach(() => {
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
    clipboardDescriptor = undefined;
    vi.restoreAllMocks();
  });

  for (const mode of ['add', 'edit'] as const) {
    it(`copies the full address from the ${mode} bookmark dialog`, async () => {
      const address = `${'a'.repeat(32)}:/start\`c=heap`;
      const writeText = vi.fn().mockResolvedValue(undefined);
      clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });

      render(NomadBookmarkEditor, {
        address,
        currentName: 'Node',
        mode,
        onsave: vi.fn().mockResolvedValue(true),
        oncancel: vi.fn(),
      });

      const copyButton = screen.getByRole('button', { name: 'Copy bookmark address' });
      expect(copyButton).toHaveTextContent(address);
      await fireEvent.click(copyButton);

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(address));
    });
  }

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
