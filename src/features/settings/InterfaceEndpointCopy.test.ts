import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTcpInterfaceDraft,
  createUdpInterfaceDraft,
  createWebSocketInterfaceDraft,
} from '../../domain/settings';
import TcpInterfaceEditor from './TcpInterfaceEditor.svelte';
import UdpInterfaceEditor from './UdpInterfaceEditor.svelte';
import WebSocketInterfaceEditor from './WebSocketInterfaceEditor.svelte';

describe('interface endpoint copy actions', () => {
  let clipboardDescriptor: PropertyDescriptor | undefined;
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
    vi.restoreAllMocks();
  });

  it('copies the WebSocket endpoint preview', async () => {
    render(WebSocketInterfaceEditor, {
      config: createWebSocketInterfaceDraft('websocket-copy'),
      oncancel: vi.fn(),
      onsave: vi.fn(),
    });

    const copy = screen.getByRole('button', { name: 'Copy endpoint address' });
    expect(copy).toHaveTextContent('ws://localhost:8765/');
    await fireEvent.click(copy);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('ws://localhost:8765/'));
  });

  it('copies the TCP endpoint preview', async () => {
    render(TcpInterfaceEditor, {
      config: createTcpInterfaceDraft('tcp-copy'),
      oncancel: vi.fn(),
      onsave: vi.fn(),
    });

    const copy = screen.getByRole('button', { name: 'Copy endpoint address' });
    expect(copy).toHaveTextContent('localhost:4242');
    await fireEvent.click(copy);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('localhost:4242'));
  });

  it('copies the UDP endpoint preview', async () => {
    render(UdpInterfaceEditor, {
      config: createUdpInterfaceDraft('udp-copy'),
      oncancel: vi.fn(),
      onsave: vi.fn(),
    });

    const copy = screen.getByRole('button', { name: 'Copy endpoint address' });
    expect(copy).toHaveTextContent('0.0.0.0:4242 → 255.255.255.255:4242');
    await fireEvent.click(copy);

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      '0.0.0.0:4242 → 255.255.255.255:4242',
    ));
  });
});
