import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { reticulumRuntime } from '../../infrastructure/reticulum/runtime';
import ToastViewport from '../../lib/components/ToastViewport.svelte';
import { clearToasts } from '../../lib/notifications/toasts';
import NewConversationEditor from './NewConversationEditor.svelte';

const scanner = vi.hoisted(() => ({
  callback: undefined as undefined | ((
    result: { getText(): string } | undefined,
    error: unknown,
    controls: { stop(): void },
  ) => void),
  decode: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('@zxing/browser', () => ({
  BrowserQRCodeReader: class {
    decodeFromConstraints(
      _constraints: MediaStreamConstraints,
      _video: HTMLVideoElement,
      callback: typeof scanner.callback,
    ) {
      scanner.callback = callback;
      scanner.decode();
      return Promise.resolve({ stop: scanner.stop });
    }
  },
}));

const validLxmaAddress = 'lxma://7b5663f27a4c0bcc301b2967a243e058:d6c7123ef37072ee5fe66a3c7caf5b78e325f2917d1b46464c9872069bde2d3d972a4da471ac1fe239ff1f5c5d2a9b7d28eac5bec513eebc86f5f7ea1a8bc4d4';

describe('NewConversationEditor QR scanner', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    scanner.callback = undefined;
    scanner.decode.mockClear();
    scanner.stop.mockClear();
    clearToasts();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn() },
    });
  });

  it('verifies a pasted LXMA address through the worker before opening the chat', async () => {
    const onopen = vi.fn();
    const importPeer = vi.spyOn(reticulumRuntime, 'importLxmaPeer')
      .mockResolvedValue('7b5663f27a4c0bcc301b2967a243e058');
    render(NewConversationEditor, { oncancel: vi.fn(), onopen });

    await fireEvent.input(screen.getByLabelText('LXMF destination'), { target: { value: validLxmaAddress } });
    await fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }));

    await waitFor(() => expect(importPeer).toHaveBeenCalledWith(validLxmaAddress));
    expect(onopen).toHaveBeenCalledWith('7b5663f27a4c0bcc301b2967a243e058');
  });

  it('shows an error toast when a pasted LXMA address fails worker verification', async () => {
    const onopen = vi.fn();
    vi.spyOn(reticulumRuntime, 'importLxmaPeer').mockResolvedValue(undefined);
    render(NewConversationEditor, { oncancel: vi.fn(), onopen });
    render(ToastViewport);
    const mismatchedAddress = validLxmaAddress.replace('7b5663f27a4c0bcc301b2967a243e058', '0'.repeat(32));

    await fireEvent.input(screen.getByLabelText('LXMF destination'), { target: { value: mismatchedAddress } });
    await fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }));

    expect(await screen.findByText('The LXMA address is invalid or does not match its public key.')).toBeInTheDocument();
    expect(onopen).not.toHaveBeenCalled();
  });

  it('shows a toast and keeps the scanner open for an invalid QR code', async () => {
    const onopen = vi.fn();
    vi.spyOn(reticulumRuntime, 'importLxmaPeer').mockResolvedValue(undefined);
    render(NewConversationEditor, { oncancel: vi.fn(), onopen });
    render(ToastViewport);

    await fireEvent.click(screen.getByRole('button', { name: 'Scan LXMA QR code' }));
    await waitFor(() => expect(scanner.decode).toHaveBeenCalledOnce());
    scanner.callback?.({ getText: () => 'https://example.com/not-an-lxma-address' }, undefined, { stop: scanner.stop });

    expect(await screen.findByText('The QR code does not contain a valid LXMA address.')).toBeInTheDocument();
    expect(onopen).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Close QR scanner' })).toBeInTheDocument();
  });

  it('verifies an LXMA QR code, imports its identity and opens the chat', async () => {
    const onopen = vi.fn();
    const importPeer = vi.spyOn(reticulumRuntime, 'importLxmaPeer')
      .mockResolvedValue('7b5663f27a4c0bcc301b2967a243e058');
    render(NewConversationEditor, { oncancel: vi.fn(), onopen });

    await fireEvent.click(screen.getByRole('button', { name: 'Scan LXMA QR code' }));
    await waitFor(() => expect(scanner.decode).toHaveBeenCalledOnce());
    scanner.callback?.({ getText: () => validLxmaAddress }, undefined, { stop: scanner.stop });

    await waitFor(() => expect(onopen).toHaveBeenCalledWith('7b5663f27a4c0bcc301b2967a243e058'));
    expect(importPeer).toHaveBeenCalledWith(validLxmaAddress);
    expect(scanner.stop).toHaveBeenCalled();
  });
});
