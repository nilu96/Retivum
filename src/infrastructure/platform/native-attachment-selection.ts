import {
  FilePicker,
  type PickedFile,
} from '@capawesome/capacitor-file-picker';
import {
  Camera,
  CameraErrorCode,
  type MediaResult,
} from '@capacitor/camera';
import { Capacitor } from '@capacitor/core';
import { MAX_CHAT_ATTACHMENT_BYTES } from '../../domain/chat-attachments';

const CANCELLED_SELECTION_CODES = new Set<string>([
  CameraErrorCode.TakePhotoCancelled,
]);

function selectionsFit(files: Array<{ size?: number }>): boolean {
  return files.reduce((total, file) => total + Math.max(0, file.size ?? 0), 0)
    <= MAX_CHAT_ATTACHMENT_BYTES;
}

function assertSelectionsFit(files: Array<{ size?: number }>): void {
  if (!selectionsFit(files)) throw new Error('LXMF_ATTACHMENTS_TOO_LARGE');
}

function imageFormat(result: MediaResult, blob: Blob): string {
  const metadataFormat = result.metadata?.format.toLowerCase();
  if (metadataFormat) return metadataFormat === 'jpg' ? 'jpeg' : metadataFormat;
  const mimeFormat = blob.type.toLowerCase().match(/^image\/([a-z0-9.+-]+)$/)?.[1];
  return mimeFormat === 'jpg' ? 'jpeg' : mimeFormat ?? 'jpeg';
}

function imageExtension(format: string): string {
  if (format === 'jpeg') return 'jpg';
  if (format === 'svg+xml') return 'svg';
  return format.replace(/[^a-z0-9]/g, '') || 'jpg';
}

function sourceFileName(result: MediaResult): string | undefined {
  const path = result.uri?.split(/[?#]/, 1)[0];
  if (!path) return undefined;
  const segment = path.slice(path.lastIndexOf('/') + 1);
  if (!segment || !segment.includes('.')) return undefined;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

async function mediaResultFile(result: MediaResult, fallbackName: string): Promise<File> {
  if (!result.webPath) throw new Error('NATIVE_PHOTO_WEB_PATH_MISSING');
  const response = await fetch(result.webPath);
  if (!response.ok) throw new Error('NATIVE_PHOTO_READ_FAILED');
  const blob = await response.blob();
  const format = imageFormat(result, blob);
  const mimeType = blob.type.startsWith('image/') ? blob.type : `image/${format}`;
  const name = sourceFileName(result) ?? `${fallbackName}.${imageExtension(format)}`;
  const creationTime = result.metadata?.creationDate
    ? Date.parse(result.metadata.creationDate)
    : Number.NaN;
  return new File([blob], name, {
    type: mimeType,
    lastModified: Number.isFinite(creationTime) ? creationTime : Date.now(),
  });
}

async function pickedFileResult(file: PickedFile): Promise<File> {
  const source = file.blob
    ? file.blob
    : file.path
      ? await fetch(Capacitor.convertFileSrc(file.path)).then((response) => {
        if (!response.ok) throw new Error('NATIVE_FILE_READ_FAILED');
        return response.blob();
      })
      : undefined;
  if (!source) throw new Error('NATIVE_FILE_PATH_MISSING');
  return new File([source], file.name, {
    type: file.mimeType || source.type || 'application/octet-stream',
    lastModified: file.modifiedAt ?? Date.now(),
  });
}

function selectionWasCancelled(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && CANCELLED_SELECTION_CODES.has(String(error.code));
}

function fileSelectionWasCancelled(error: unknown): boolean {
  return error instanceof Error && error.message === 'pickFiles canceled.';
}

export async function takeNativePhoto(): Promise<File[]> {
  try {
    const result = await Camera.takePhoto({
      correctOrientation: true,
      editable: 'no',
      includeMetadata: true,
      quality: 100,
      saveToGallery: false,
    });
    assertSelectionsFit([{ size: result.metadata?.size }]);
    return [await mediaResultFile(result, `photo-${Date.now()}`)];
  } catch (error) {
    if (selectionWasCancelled(error)) return [];
    throw error;
  }
}

export async function chooseNativePhotos(): Promise<File[]> {
  try {
    const { files } = await FilePicker.pickImages({
      limit: 0,
      ordered: false,
      readData: false,
      skipTranscoding: true,
    });
    assertSelectionsFit(files);
    return await Promise.all(files.map(pickedFileResult));
  } catch (error) {
    if (fileSelectionWasCancelled(error)) return [];
    throw error;
  }
}

export async function chooseNativeFiles(): Promise<File[]> {
  try {
    const { files } = await FilePicker.pickFiles({
      limit: 0,
      readData: false,
    });
    assertSelectionsFit(files);
    return await Promise.all(files.map(pickedFileResult));
  } catch (error) {
    if (fileSelectionWasCancelled(error)) return [];
    throw error;
  }
}
