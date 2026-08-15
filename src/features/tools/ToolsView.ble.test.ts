import { render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('ToolsView Bluetooth capability', () => {
  afterEach(() => {
    vi.doUnmock('../../infrastructure/platform/interface-capabilities');
    vi.resetModules();
  });

  it('offers local RNode configuration on a BLE-only platform', async () => {
    vi.doMock('../../infrastructure/platform/interface-capabilities', () => ({
      detectInterfaceCapabilities: () => ({
        websocket: false,
        rnodeConnections: ['ble'],
        tcp: false,
        udp: false,
      }),
    }));
    const { default: ToolsView } = await import('./ToolsView.svelte');

    render(ToolsView);

    expect(screen.getByRole('heading', { name: 'Local RNode configuration' })).toBeInTheDocument();
  });
});
