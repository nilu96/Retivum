import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearToasts, toasts } from '../../lib/notifications/toasts';

const deviceMocks = vi.hoisted(() => ({
  select: vi.fn(),
  authorize: vi.fn(),
}));

vi.mock('../../infrastructure/platform/interface-capabilities', () => ({
  selectRNodeDevice: deviceMocks.select,
  authorizeRNodeDevice: deviceMocks.authorize,
}));

import RNodeInterfaceEditor from './RNodeInterfaceEditor.svelte';

describe('RNodeInterfaceEditor Bluetooth pairing', () => {
  beforeEach(() => {
    clearToasts();
    deviceMocks.select.mockReset().mockResolvedValue({
      deviceId: 'ble-rnode',
      deviceName: 'Pocket RNode',
    });
    deviceMocks.authorize.mockReset();
  });

  afterEach(() => {
    cleanup();
    clearToasts();
  });

  it.each([
    new Error('RNODE_BLE_PAIRING_FAILED'),
    new Error('RNODE_BLE_PAIRING_CANCELLED'),
    new Error('Creating bond failed.'),
  ])('reports a cancelled or rejected pairing once and allows a fresh device selection', async (error) => {
    deviceMocks.authorize.mockRejectedValue(error);
    render(RNodeInterfaceEditor, {
      connections: ['ble'],
      oncancel: vi.fn(),
      onsave: vi.fn(),
    });

    const selectDevice = screen.getByRole('button', { name: 'Select device' });
    await fireEvent.click(selectDevice);

    await waitFor(() => expect(get(toasts)).toContainEqual(expect.objectContaining({
      kind: 'error',
      messageKey: 'interface.editor.rnode.device.pairingError',
    })));
    expect(selectDevice).toBeEnabled();

    await fireEvent.click(selectDevice);
    await waitFor(() => expect(deviceMocks.select).toHaveBeenCalledTimes(2));
    expect(deviceMocks.authorize).toHaveBeenCalledTimes(2);
  });
});
