import { beforeEach, describe, expect, it, vi } from 'vitest';

const platformMocks = vi.hoisted(() => ({
  platform: 'ios',
  native: true,
  shareImage: vi.fn(),
  writeFile: vi.fn(),
  shareFile: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: () => platformMocks.platform,
    isNativePlatform: () => platformMocks.native,
  },
  registerPlugin: () => ({ shareImage: platformMocks.shareImage }),
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Cache: 'CACHE' },
  Filesystem: { writeFile: platformMocks.writeFile },
}));

vi.mock('@capacitor/share', () => ({
  Share: { share: platformMocks.shareFile },
}));

import { saveChatFile } from './file-save';

describe('saveChatFile', () => {
  beforeEach(() => {
    platformMocks.platform = 'ios';
    platformMocks.native = true;
    platformMocks.shareImage.mockReset().mockResolvedValue({ completed: true });
    platformMocks.writeFile.mockReset().mockResolvedValue({ uri: 'file:///attachment' });
    platformMocks.shareFile.mockReset().mockResolvedValue({});
  });

  it('shares iOS images as native image objects', async () => {
    await expect(saveChatFile('photo.jpg', 'image/jpeg', new Uint8Array([1, 2, 3]), 'image')).resolves.toBe(true);

    expect(platformMocks.shareImage).toHaveBeenCalledWith({
      data: 'AQID',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
    });
    expect(platformMocks.writeFile).not.toHaveBeenCalled();
    expect(platformMocks.shareFile).not.toHaveBeenCalled();
  });

  it('retains generic native sharing for non-image attachments', async () => {
    await expect(saveChatFile('notes.txt', 'text/plain', new Uint8Array([1, 2, 3]))).resolves.toBe(true);

    expect(platformMocks.shareImage).not.toHaveBeenCalled();
    expect(platformMocks.writeFile).toHaveBeenCalledWith(expect.objectContaining({ data: 'AQID' }));
    expect(platformMocks.shareFile).toHaveBeenCalledWith({ title: 'notes.txt', files: ['file:///attachment'] });
  });

  it('uses the native image save chooser on Android', async () => {
    platformMocks.platform = 'android';

    await expect(saveChatFile('photo.jpg', 'image/jpeg', new Uint8Array([1, 2, 3]), 'image')).resolves.toBe(true);

    expect(platformMocks.shareImage).toHaveBeenCalledWith({
      data: 'AQID',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
    });
    expect(platformMocks.writeFile).not.toHaveBeenCalled();
    expect(platformMocks.shareFile).not.toHaveBeenCalled();
  });

  it('falls back to generic sharing only for explicitly unsupported image encodings', async () => {
    platformMocks.shareImage.mockRejectedValue(Object.assign(new Error('unsupported image'), {
      code: 'UNSUPPORTED_IMAGE_ENCODING',
    }));

    await expect(saveChatFile('photo.webp', 'image/webp', new Uint8Array([1, 2, 3]), 'image')).resolves.toBe(true);

    expect(platformMocks.writeFile).toHaveBeenCalled();
    expect(platformMocks.shareFile).toHaveBeenCalled();
  });

  it('does not silently use generic sharing when the iOS bridge is unavailable', async () => {
    platformMocks.shareImage.mockRejectedValue(Object.assign(new Error('plugin unavailable'), {
      code: 'UNIMPLEMENTED',
    }));

    await expect(saveChatFile('photo.jpg', 'image/jpeg', new Uint8Array([1, 2, 3]), 'image')).resolves.toBe(false);

    expect(platformMocks.writeFile).not.toHaveBeenCalled();
    expect(platformMocks.shareFile).not.toHaveBeenCalled();
  });
});
