import { beforeEach, describe, expect, it, vi } from 'vitest';

const filePickerMocks = vi.hoisted(() => ({
  pickFiles: vi.fn(),
  pickImages: vi.fn(),
}));

const cameraMocks = vi.hoisted(() => ({
  takePhoto: vi.fn(),
}));

vi.mock('@capawesome/capacitor-file-picker', () => ({
  FilePicker: filePickerMocks,
}));

vi.mock('@capacitor/camera', () => ({
  Camera: cameraMocks,
  CameraErrorCode: {
    TakePhotoCancelled: 'OS-PLUG-CAMR-0006',
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    convertFileSrc: (path: string) => `https://localhost/_capacitor_file_/${path}`,
  },
}));

import {
  chooseNativeFiles,
  chooseNativePhotos,
  takeNativePhoto,
} from './native-attachment-selection';

function photoResult(webPath: string, uri: string, format = 'jpeg') {
  return {
    metadata: {
      creationDate: '2026-07-26T10:00:00.000Z',
      format,
    },
    saved: false,
    type: 0,
    uri,
    webPath,
  };
}

describe('native attachment selection', () => {
  beforeEach(() => {
    filePickerMocks.pickFiles.mockReset();
    filePickerMocks.pickImages.mockReset();
    cameraMocks.takePhoto.mockReset();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      blob: async () => new Blob(['image'], { type: 'image/jpeg' }),
      ok: true,
    })));
  });

  it('opens the native document picker and converts all selected files', async () => {
    filePickerMocks.pickFiles.mockResolvedValue({
      files: [{
        mimeType: 'text/plain',
        modifiedAt: 1_775_000_000_000,
        name: 'notes.txt',
        path: 'file:///cache/notes.txt',
        size: 5,
      }],
    });

    const files = await chooseNativeFiles();

    expect(filePickerMocks.pickFiles).toHaveBeenCalledWith({
      limit: 0,
      readData: false,
    });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      name: 'notes.txt',
      type: 'text/plain',
    });
  });

  it('uses the dedicated native camera flow and converts its result to a file', async () => {
    cameraMocks.takePhoto.mockResolvedValue(photoResult(
      'https://localhost/_capacitor_file_/camera/photo.jpg',
      'file:///cache/photo.jpg',
    ));

    const files = await takeNativePhoto();

    expect(cameraMocks.takePhoto).toHaveBeenCalledWith(expect.objectContaining({
      correctOrientation: true,
      saveToGallery: false,
    }));
    expect(filePickerMocks.pickImages).not.toHaveBeenCalled();
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      name: 'photo.jpg',
      type: 'image/jpeg',
    });
  });

  it('uses the limited native image picker and preserves multiple selected images', async () => {
    filePickerMocks.pickImages.mockResolvedValue({
      files: [
        {
          mimeType: 'image/jpeg',
          name: 'first.jpg',
          path: 'file:///cache/first.jpg',
          size: 5,
        },
        {
          mimeType: 'image/png',
          name: 'second.png',
          path: 'file:///cache/second.png',
          size: 5,
        },
      ],
    });

    const files = await chooseNativePhotos();

    expect(filePickerMocks.pickImages).toHaveBeenCalledWith({
      limit: 0,
      ordered: false,
      readData: false,
      skipTranscoding: true,
    });
    expect(cameraMocks.takePhoto).not.toHaveBeenCalled();
    expect(files.map((file) => file.name)).toEqual(['first.jpg', 'second.png']);
  });

  it('treats cancelling the native camera as an empty selection', async () => {
    cameraMocks.takePhoto.mockRejectedValue({ code: 'OS-PLUG-CAMR-0006' });

    await expect(takeNativePhoto()).resolves.toEqual([]);
  });

  it('treats cancelling the native image picker as an empty selection', async () => {
    filePickerMocks.pickImages.mockRejectedValue(new Error('pickFiles canceled.'));

    await expect(chooseNativePhotos()).resolves.toEqual([]);
  });

  it('treats cancelling the native document picker as an empty selection', async () => {
    filePickerMocks.pickFiles.mockRejectedValue(new Error('pickFiles canceled.'));

    await expect(chooseNativeFiles()).resolves.toEqual([]);
  });
});
