import { DEFAULT_CHAT_IMAGE_LONG_EDGE } from '../../domain/settings';

export { DEFAULT_CHAT_IMAGE_LONG_EDGE };
export const CHAT_IMAGE_JPEG_QUALITY = 0.85;

export interface ChatImageDownscaleCandidate {
  file: File;
  width: number;
  height: number;
  targetWidth: number;
  targetHeight: number;
  outputMimeType: 'image/jpeg' | 'image/png';
  outputName: string;
  source: CanvasImageSource;
  dispose: () => void;
}

export interface DownscaledChatImage {
  name: string;
  mimeType: 'image/jpeg' | 'image/png';
  data: Uint8Array;
  width: number;
  height: number;
}

export interface PngFeatures {
  animated: boolean;
  mayHaveTransparency: boolean;
}

export function targetImageDimensions(
  width: number,
  height: number,
  maximumLongEdge = DEFAULT_CHAT_IMAGE_LONG_EDGE,
): { width: number; height: number } {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const longEdge = Math.max(safeWidth, safeHeight);
  if (longEdge <= maximumLongEdge) return { width: safeWidth, height: safeHeight };
  const scale = maximumLongEdge / longEdge;
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

export function inspectPngFeatures(data: Uint8Array): PngFeatures {
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length < pngSignature.length
    || pngSignature.some((value, index) => data[index] !== value)) {
    return { animated: false, mayHaveTransparency: true };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 8;
  let mayHaveTransparency = false;
  while (offset + 12 <= data.length) {
    const length = view.getUint32(offset);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > data.length) break;
    const type = String.fromCharCode(
      data[offset + 4],
      data[offset + 5],
      data[offset + 6],
      data[offset + 7],
    );
    if (type === 'acTL') return { animated: true, mayHaveTransparency };
    if (type === 'IHDR' && length >= 10) {
      const colorType = data[offset + 8 + 9];
      mayHaveTransparency = colorType === 4 || colorType === 6;
    } else if (type === 'tRNS') {
      mayHaveTransparency = true;
    } else if (type === 'IDAT') {
      break;
    }
    offset = chunkEnd;
  }
  return { animated: false, mayHaveTransparency };
}

export async function inspectChatImageForDownscale(
  file: File,
  maximumLongEdge = DEFAULT_CHAT_IMAGE_LONG_EDGE,
): Promise<ChatImageDownscaleCandidate | undefined> {
  const mimeType = file.type.toLowerCase().split(';', 1)[0];
  if (mimeType !== 'image/jpeg' && mimeType !== 'image/png') return undefined;

  let outputMimeType: ChatImageDownscaleCandidate['outputMimeType'] = 'image/jpeg';
  if (mimeType === 'image/png') {
    const pngFeatures = inspectPngFeatures(new Uint8Array(await file.arrayBuffer()));
    if (pngFeatures.animated) return undefined;
    if (pngFeatures.mayHaveTransparency) outputMimeType = 'image/png';
  }

  const loaded = await loadImage(file);
  const target = targetImageDimensions(loaded.width, loaded.height, maximumLongEdge);
  if (target.width === loaded.width && target.height === loaded.height) {
    loaded.dispose();
    return undefined;
  }

  return {
    file,
    width: loaded.width,
    height: loaded.height,
    targetWidth: target.width,
    targetHeight: target.height,
    outputMimeType,
    outputName: imageOutputName(file.name, outputMimeType),
    source: loaded.source,
    dispose: loaded.dispose,
  };
}

export async function downscaleChatImage(
  candidate: ChatImageDownscaleCandidate,
): Promise<DownscaledChatImage> {
  const canvas = document.createElement('canvas');
  canvas.width = candidate.targetWidth;
  canvas.height = candidate.targetHeight;
  const context = canvas.getContext('2d', {
    alpha: candidate.outputMimeType === 'image/png',
  });
  if (!context) throw new Error('IMAGE_DOWNSCALE_CONTEXT_UNAVAILABLE');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(candidate.source, 0, 0, candidate.targetWidth, candidate.targetHeight);

  const blob = await canvasToBlob(
    canvas,
    candidate.outputMimeType,
    candidate.outputMimeType === 'image/jpeg' ? CHAT_IMAGE_JPEG_QUALITY : undefined,
  );
  return {
    name: candidate.outputName,
    mimeType: candidate.outputMimeType,
    data: new Uint8Array(await blob.arrayBuffer()),
    width: candidate.targetWidth,
    height: candidate.targetHeight,
  };
}

function imageOutputName(name: string, mimeType: 'image/jpeg' | 'image/png'): string {
  const extension = mimeType === 'image/png' ? 'png' : 'jpg';
  const baseName = name.replace(/\.[^./\\]+$/, '').trim() || 'image';
  return `${baseName}.${extension}`;
}

async function loadImage(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        dispose: () => bitmap.close(),
      };
    } catch {
      // Fall through to the broadly supported image-element decoder.
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('IMAGE_DECODE_FAILED'));
      image.src = objectUrl;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality?: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('IMAGE_ENCODE_FAILED'));
    }, mimeType, quality);
  });
}
