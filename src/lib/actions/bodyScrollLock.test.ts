import { afterEach, describe, expect, it, vi } from 'vitest';
import { setOverlayBackdropVisible } from '../../infrastructure/appearance/theme';
import { lockBodyScroll } from './bodyScrollLock';

vi.mock('../../infrastructure/appearance/theme', () => ({
  setOverlayBackdropVisible: vi.fn(),
}));

describe('lockBodyScroll', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.classList.remove('overlay-open');
    document.documentElement.removeAttribute('style');
    document.body.removeAttribute('style');
    vi.mocked(setOverlayBackdropVisible).mockClear();
  });

  it('freezes and restores the mobile document at its current scroll position', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    vi.spyOn(window, 'scrollX', 'get').mockReturnValue(0);
    vi.spyOn(window, 'scrollY', 'get').mockReturnValueOnce(180).mockReturnValue(0);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);

    const action = lockBodyScroll(document.createElement('div'));
    expect(setOverlayBackdropVisible).toHaveBeenCalledWith(true);
    expect(document.documentElement).toHaveClass('overlay-open');
    expect(document.documentElement.style.overflow).toBe('hidden');
    expect(document.body.style.position).toBe('fixed');
    expect(document.body.style.inset).toContain('-180px');

    action.destroy();
    expect(setOverlayBackdropVisible).toHaveBeenLastCalledWith(false);
    expect(document.documentElement).not.toHaveClass('overlay-open');
    expect(document.body.style.position).toBe('');
    expect(scrollTo).toHaveBeenCalledWith(0, 180);
  });
});
