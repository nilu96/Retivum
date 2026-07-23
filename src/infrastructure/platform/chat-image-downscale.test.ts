import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_IMAGE_JPEG_QUALITY,
  DEFAULT_CHAT_IMAGE_LONG_EDGE,
  downscaleChatImage,
  inspectChatImageForDownscale,
  inspectPngFeatures,
  targetImageDimensions,
} from './chat-image-downscale';

describe('chat image downscaling', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reduces only the long edge and preserves the aspect ratio', () => {
    expect(targetImageDimensions(4_096, 2_048)).toEqual({ width: 1_500, height: 750 });
    expect(targetImageDimensions(1_500, 3_000)).toEqual({ width: 750, height: 1_500 });
    expect(targetImageDimensions(1_200, 800)).toEqual({ width: 1_200, height: 800 });
  });

  it('detects APNG animation and PNG transparency metadata', () => {
    expect(inspectPngFeatures(pngBytes([
      pngChunk('IHDR', Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
      pngChunk('acTL', new Uint8Array(8)),
    ]))).toEqual({ animated: true, mayHaveTransparency: true });

    expect(inspectPngFeatures(pngBytes([
      pngChunk('IHDR', Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
      pngChunk('IDAT', new Uint8Array(0)),
    ]))).toEqual({ animated: false, mayHaveTransparency: false });
  });

  it('leaves unsupported image formats untouched', async () => {
    const createBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createBitmap);

    await expect(inspectChatImageForDownscale(
      new File([new Uint8Array(10)], 'animation.gif', { type: 'image/gif' }),
    )).resolves.toBeUndefined();
    expect(createBitmap).not.toHaveBeenCalled();
  });

  it('leaves APNG untouched and preserves possible PNG transparency', async () => {
    const animatedBytes = pngBytes([
      pngChunk('IHDR', Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
      pngChunk('acTL', new Uint8Array(8)),
    ]);
    const animatedFile = fileWithBytes(animatedBytes, 'animated.png', 'image/png');
    const createBitmap = vi.fn();
    vi.stubGlobal('createImageBitmap', createBitmap);

    await expect(inspectChatImageForDownscale(animatedFile)).resolves.toBeUndefined();
    expect(createBitmap).not.toHaveBeenCalled();

    const transparentBytes = pngBytes([
      pngChunk('IHDR', Uint8Array.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0])),
      pngChunk('IDAT', new Uint8Array(0)),
    ]);
    createBitmap.mockResolvedValue({ width: 3_000, height: 1_500, close: vi.fn() });
    const candidate = await inspectChatImageForDownscale(
      fileWithBytes(transparentBytes, 'transparent.png', 'image/png'),
    );
    expect(candidate).toMatchObject({
      outputMimeType: 'image/png',
      outputName: 'transparent.png',
      targetWidth: 1_500,
      targetHeight: 750,
    });
    candidate?.dispose();
  });

  it('decodes once, calculates the fixed target, and encodes once as JPEG', async () => {
    const close = vi.fn();
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({
      width: 4_000,
      height: 2_000,
      close,
    }));
    const file = new File([new Uint8Array(200)], 'large.jpeg', { type: 'image/jpeg' });
    const candidate = await inspectChatImageForDownscale(file);
    expect(candidate).toMatchObject({
      width: 4_000,
      height: 2_000,
      targetWidth: DEFAULT_CHAT_IMAGE_LONG_EDGE,
      targetHeight: 750,
      outputMimeType: 'image/jpeg',
      outputName: 'large.jpg',
    });

    const drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      drawImage,
    } as unknown as CanvasRenderingContext2D);
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(
      (callback, mimeType, quality) => {
        expect(mimeType).toBe('image/jpeg');
        expect(quality).toBe(CHAT_IMAGE_JPEG_QUALITY);
        callback({
          arrayBuffer: async () => new Uint8Array(80).buffer,
        } as Blob);
      },
    );

    const result = await downscaleChatImage(candidate!);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(drawImage).toHaveBeenCalledWith(candidate!.source, 0, 0, 1_500, 750);
    expect(toBlob).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      name: 'large.jpg',
      mimeType: 'image/jpeg',
      width: 1_500,
      height: 750,
    });
    expect(result.data).toHaveLength(80);

    candidate!.dispose();
    expect(close).toHaveBeenCalledOnce();
  });
});

function pngBytes(chunks: Uint8Array[]): Uint8Array {
  const signature = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const result = new Uint8Array(signature.length + chunks.reduce((total, chunk) => total + chunk.length, 0));
  result.set(signature);
  let offset = signature.length;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  new DataView(chunk.buffer).setUint32(0, data.length);
  for (let index = 0; index < 4; index += 1) chunk[4 + index] = type.charCodeAt(index);
  chunk.set(data, 8);
  return chunk;
}

function fileWithBytes(data: Uint8Array, name: string, type: string): File {
  const bytes = data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
  const file = new File([bytes], name, { type });
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => bytes,
  });
  return file;
}
