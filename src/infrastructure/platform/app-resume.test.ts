import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  listener: undefined as ((state: { isActive: boolean }) => void) | undefined,
  remove: vi.fn(async () => undefined),
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (
      _event: string,
      listener: (state: { isActive: boolean }) => void,
    ) => {
      native.listener = listener;
      return { remove: native.remove };
    }),
  },
}));

import { listenForAppResume } from './app-resume';

describe('app resume lifecycle adapter', () => {
  beforeEach(() => {
    delete document.documentElement.dataset.nativePlatform;
    window.retivumDesktopLifecycle = undefined;
    native.listener = undefined;
    native.remove.mockClear();
    vi.restoreAllMocks();
  });

  it('reports a mobile resume only after the app was inactive', async () => {
    document.documentElement.dataset.nativePlatform = 'ios';
    const listener = vi.fn();
    const dispose = await listenForAppResume(listener);

    native.listener?.({ isActive: true });
    expect(listener).not.toHaveBeenCalled();
    native.listener?.({ isActive: false });
    native.listener?.({ isActive: true });
    expect(listener).toHaveBeenCalledOnce();

    await dispose();
    expect(native.remove).toHaveBeenCalledOnce();
  });

  it('uses the sandboxed Electron lifecycle bridge when available', async () => {
    let resume: (() => void) | undefined;
    const remove = vi.fn();
    window.retivumDesktopLifecycle = {
      onResume: (listener) => {
        resume = listener;
        return remove;
      },
    };
    const listener = vi.fn();
    const dispose = await listenForAppResume(listener);

    resume?.();
    expect(listener).toHaveBeenCalledOnce();
    await dispose();
    expect(remove).toHaveBeenCalledOnce();
  });

  it('reports when a browser page returns from the background', async () => {
    let visibility: DocumentVisibilityState = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    const listener = vi.fn();
    const dispose = await listenForAppResume(listener);

    document.dispatchEvent(new Event('visibilitychange'));
    expect(listener).not.toHaveBeenCalled();
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(listener).toHaveBeenCalledOnce();

    await dispose();
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    expect(listener).toHaveBeenCalledOnce();
  });
});
