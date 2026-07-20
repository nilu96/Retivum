import { Capacitor, registerPlugin } from '@capacitor/core';

interface RetivumImageSharePlugin {
  shareImage(options: {
    data: string;
    name: string;
    mimeType: string;
  }): Promise<{ activityType?: string; completed: boolean }>;
}

export type ChatFileContentKind = 'image' | 'audio' | 'file';

const nativeImageShare = registerPlugin<RetivumImageSharePlugin>('RetivumImageShare');

export async function saveChatFile(
  name: string,
  mimeType: string,
  data: Uint8Array,
  contentKind?: ChatFileContentKind,
): Promise<boolean> {
  const safeName = name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').slice(0, 255) || 'attachment.bin';
  try {
    if (Capacitor.isNativePlatform()) {
      const base64Data = bytesToBase64(data);
      const isImage = contentKind === 'image'
        || (contentKind === undefined && mimeType.toLowerCase().startsWith('image/'));
      if ((Capacitor.getPlatform() === 'ios' || Capacitor.getPlatform() === 'android') && isImage) {
        try {
          await nativeImageShare.shareImage({ data: base64Data, name: safeName, mimeType });
          return true;
        } catch (error) {
          if (nativeErrorCode(error) !== 'UNSUPPORTED_IMAGE_ENCODING') throw error;
          // Encodings that UIKit cannot decode still use the generic file share path.
        }
      }
      const [{ Directory, Filesystem }, { Share }] = await Promise.all([
        import('@capacitor/filesystem'),
        import('@capacitor/share'),
      ]);
      const result = await Filesystem.writeFile({
        path: `retivum-share/${crypto.randomUUID()}-${safeName}`,
        data: base64Data,
        directory: Directory.Cache,
        recursive: true,
      });
      await Share.share({ title: safeName, files: [result.uri] });
      return true;
    }
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mimeType }));
    const link = document.createElement('a');
    link.href = url;
    link.download = safeName;
    link.style.display = 'none';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
    return true;
  } catch {
    return false;
  }
}

function nativeErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

function bytesToBase64(data: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < data.length; offset += 0x8000) {
    binary += String.fromCharCode(...data.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}
