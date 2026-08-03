import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { APP_RESUME_CHANNEL, installDesktopAppLifecycle } from './app-lifecycle.mjs';

describe('Electron app lifecycle bridge', () => {
  it('forwards system resume events only while the window is alive', () => {
    const powerMonitor = new EventEmitter();
    let destroyed = false;
    const send = vi.fn();
    const window = {
      isDestroyed: () => destroyed,
      webContents: { send },
    };
    const dispose = installDesktopAppLifecycle(window, powerMonitor);

    powerMonitor.emit('resume');
    expect(send).toHaveBeenCalledWith(APP_RESUME_CHANNEL);

    destroyed = true;
    powerMonitor.emit('resume');
    expect(send).toHaveBeenCalledOnce();

    dispose();
    destroyed = false;
    powerMonitor.emit('resume');
    expect(send).toHaveBeenCalledOnce();
  });
});
