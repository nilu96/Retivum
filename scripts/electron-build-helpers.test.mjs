import { describe, expect, it, vi } from 'vitest';
import { rebuildElectronNoble } from './electron-build-helpers.mjs';

describe('Electron native dependency preparation', () => {
  it('does not rebuild unused optional native dependencies on Linux', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await expect(rebuildElectronNoble('linux')).resolves.toBeUndefined();

    expect(info).toHaveBeenCalledWith(
      "Skipping Noble native rebuild on linux; Retivum uses Noble's JavaScript D-Bus backend.",
    );
    info.mockRestore();
  });
});
