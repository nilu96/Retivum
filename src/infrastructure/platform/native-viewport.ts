const NATIVE_VIEWPORT = [
  'width=device-width',
  'initial-scale=1',
  'maximum-scale=1',
  'user-scalable=no',
  'viewport-fit=cover',
].join(', ');

export function configureNativeViewport(isNativePlatform: boolean, platform?: string): void {
  if (!isNativePlatform) return;
  document.documentElement.dataset.nativeShell = 'true';
  if (platform) document.documentElement.dataset.nativePlatform = platform;
  let viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!viewport) {
    viewport = document.createElement('meta');
    viewport.name = 'viewport';
    document.head.append(viewport);
  }
  viewport.content = NATIVE_VIEWPORT;
}

export function isMobileNativeShell(): boolean {
  return ['android', 'ios'].includes(document.documentElement.dataset.nativePlatform ?? '');
}
