const WEB_PERMISSIONS = new Set(['bluetooth', 'serial']);
const CLIPBOARD_WRITE_PERMISSION = 'clipboard-sanitized-write';

function isClipboardWrite(permission, details) {
  return permission === CLIPBOARD_WRITE_PERMISSION && details?.isMainFrame === true;
}

function isMediaCheck(permission, details) {
  return permission === 'media'
    && details?.isMainFrame === true
    && (details.mediaType === 'audio' || details.mediaType === 'video');
}

function isMediaRequest(permission, details) {
  return permission === 'media'
    && details?.isMainFrame === true
    && Array.isArray(details.mediaTypes)
    && details.mediaTypes.length > 0
    && details.mediaTypes.every((mediaType) => mediaType === 'audio' || mediaType === 'video');
}

export function permissionCheckAllowed(trusted, permission, details) {
  return trusted
    && (WEB_PERMISSIONS.has(permission)
      || isClipboardWrite(permission, details)
      || isMediaCheck(permission, details));
}

export function permissionRequestDecision(trusted, permission, details) {
  if (!trusted) return 'deny';
  if (WEB_PERMISSIONS.has(permission) || isClipboardWrite(permission, details)) return 'allow';
  return isMediaRequest(permission, details) ? 'media' : 'deny';
}

export function requestedMediaTypes(permission, details) {
  if (!isMediaRequest(permission, details)) return undefined;
  return new Set(details.mediaTypes);
}
