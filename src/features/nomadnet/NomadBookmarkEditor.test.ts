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
    it(`edits and copies the full address from the ${mode} bookmark dialog`, async () => {
      const address = `${'a'.repeat(32)}:/start\`c=heap`;
      const editedAddress = `${'b'.repeat(32)}:/page/edited.mu`;
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

      const addressInput = screen.getByRole('textbox', { name: 'NomadNet address' });
      const copyButton = screen.getByRole('button', { name: 'Copy bookmark address' });
      expect(addressInput).toHaveValue(address);
      expect(copyButton).not.toHaveTextContent(address);
      await fireEvent.input(addressInput, { target: { value: editedAddress } });
      await fireEvent.click(addressInput);
      expect(writeText).not.toHaveBeenCalled();
      await fireEvent.click(copyButton);

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(editedAddress));
    });
  }

  it('requires and saves a trimmed local bookmark name', async () => {
    const onsave = vi.fn().mockResolvedValue(true);
    const oncancel = vi.fn();
    const editedAddress = `${'b'.repeat(32)}:/page/edited.mu`;
    render(NomadBookmarkEditor, {
      address: `${'a'.repeat(32)}:/start`,
      currentName: 'Node',
      currentIdentifyBeforeLoad: false,
      mode: 'edit',
      onsave,
      oncancel,
    });

    const nameInput = screen.getByRole('textbox', { name: 'Bookmark name' });
    expect(nameInput).toHaveValue('Node');
    expect(nameInput).toBeRequired();
    await fireEvent.input(
      screen.getByRole('textbox', { name: 'NomadNet address' }),
      { target: { value: `  ${editedAddress}  ` } },
    );
    await fireEvent.input(nameInput, { target: { value: '  Community node  ' } });
    await fireEvent.click(screen.getByRole('switch', { name: /Identify before loading/ }));
    await fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onsave).toHaveBeenCalledWith(
      editedAddress,
      'Community node',
      true,
    ));
    expect(oncancel).toHaveBeenCalledOnce();
  });

  it('does not submit an empty bookmark name', async () => {
    const onsave = vi.fn().mockResolvedValue(true);
    render(NomadBookmarkEditor, {
      address: `${'a'.repeat(32)}:/start`,
      onsave,
      oncancel: vi.fn(),
    });

    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await fireEvent.click(save);

    expect(onsave).not.toHaveBeenCalled();
  });
});
