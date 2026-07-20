import { afterEach, describe, expect, it } from 'vitest';
import { configureNativeViewport } from './native-viewport';

const originalViewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content;

describe('configureNativeViewport', () => {
  afterEach(() => {
    delete document.documentElement.dataset.nativeShell;
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (viewport && originalViewport) viewport.content = originalViewport;
    else viewport?.remove();
  });

  it('keeps browser zoom available outside the native shell', () => {
    configureNativeViewport(false);
    expect(document.documentElement.dataset.nativeShell).toBeUndefined();
    expect(document.querySelector<HTMLMetaElement>('meta[name="viewport"]')?.content).toBe(originalViewport);
  });

  it('disables scaling inside the native shell', () => {
    configureNativeViewport(true);
    expect(document.documentElement.dataset.nativeShell).toBe('true');
    const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    expect(viewport?.content).toContain('maximum-scale=1');
    expect(viewport?.content).toContain('user-scalable=no');
  });
});
