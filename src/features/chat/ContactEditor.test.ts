import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContactEditor from './ContactEditor.svelte';

describe('ContactEditor', () => {
  const destinationHash = 'a'.repeat(32);
  let clipboardDescriptor: PropertyDescriptor | undefined;

  afterEach(() => {
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
    clipboardDescriptor = undefined;
    vi.restoreAllMocks();
  });

  for (const mode of ['add', 'edit'] as const) {
    it(`copies the destination hash from the ${mode} contact dialog`, async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });

      render(ContactEditor, {
        address: destinationHash,
        currentName: 'Alice',
        mode,
        oncancel: vi.fn(),
        onsave: vi.fn().mockResolvedValue(true),
      });

      const copyButton = screen.getByRole('button', { name: 'Copy destination hash' });
      expect(copyButton).toHaveTextContent(destinationHash);
      await fireEvent.click(copyButton);

      await waitFor(() => expect(writeText).toHaveBeenCalledWith(destinationHash));
    });
  }
});
