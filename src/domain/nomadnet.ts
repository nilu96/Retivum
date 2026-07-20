export interface NomadAnnounce {
  id: string;
  identityId: string;
  destinationHash: string;
  displayName?: string;
  publicKey?: string;
  interfaceId?: string;
  hops?: number;
  heardAt: string;
}

/**
 * Updates an announced NomadNet destination without discarding metadata that
 * was omitted from a later announce projection. Path responses and other
 * rebroadcasts can carry enough information to refresh reachability while not
 * yielding a decodable node name in the UI projection.
 */
export function upsertNomadAnnounce(
  items: NomadAnnounce[],
  announce: NomadAnnounce,
): NomadAnnounce[] {
  const existing = items.find((item) => item.id === announce.id);
  const merged = existing
    ? {
        ...announce,
        displayName: announce.displayName ?? existing.displayName,
        publicKey: announce.publicKey ?? existing.publicKey,
      }
    : announce;
  return [merged, ...items.filter((item) => item.id !== announce.id)]
    .sort((left, right) => Date.parse(right.heardAt) - Date.parse(left.heardAt));
}

export const NOMAD_DEFAULT_PAGE_PATH = '/page/index.mu';

const NOMAD_PAGE_LOAD_BASE_DEADLINE_MS = 90_000;
const NOMAD_PAGE_LOAD_PER_ADDITIONAL_HOP_MS = 60_000;
const NOMAD_PAGE_LOAD_MAX_DEADLINE_MS = 5 * 60_000;

/**
 * Bounds one complete NomadNet load without penalising normal multi-hop paths.
 * A one-hop destination gets enough time for Reticulum's link handshake and a
 * page request. Each additional hop receives another minute, up to five
 * minutes for unusually long routes.
 */
export function nomadPageLoadDeadlineMs(hops?: number): number {
  const normalizedHops = typeof hops === 'number' && Number.isFinite(hops)
    ? Math.max(1, Math.floor(hops))
    : 1;
  return Math.min(
    NOMAD_PAGE_LOAD_MAX_DEADLINE_MS,
    NOMAD_PAGE_LOAD_BASE_DEADLINE_MS
      + (normalizedHops - 1) * NOMAD_PAGE_LOAD_PER_ADDITIONAL_HOP_MS,
  );
}

export type NomadRequestData = Record<string, string>;

export type NomadPageLoadStage =
  | 'findingPath'
  | 'establishingLink'
  | 'requestingPage'
  | 'receivingPage';

export type NomadPageLoadUpdate =
  | {
      type: 'progress';
      stage: NomadPageLoadStage;
      progress?: number;
      dataSize?: number;
    }
  | { type: 'failed'; code: string };

export interface NomadPage {
  destinationHash: string;
  path: string;
  requestData: NomadRequestData;
  content: string;
  receivedAt: string;
}

export interface NomadBookmark {
  id: string;
  identityId: string;
  destinationHash: string;
  path: string;
  label?: string;
  createdAt: string;
}

export function parseNomadAddress(
  value: string,
): { destinationHash: string; path: string; requestData: NomadRequestData } | undefined {
  let trimmed = value.trim().replace(/^nomad(?:net|network):\/\//i, '');
  const [address, fieldSpec] = splitNomadFieldSpec(trimmed);
  trimmed = address;
  if (/^\/[0-9a-f]{32}(?=[:/]|$)/i.test(trimmed)) trimmed = trimmed.slice(1);
  if (!trimmed) return undefined;
  const separator = trimmed.indexOf(':');
  const slash = trimmed.indexOf('/');
  const addressEnd = separator >= 0 ? separator : slash >= 0 ? slash : trimmed.length;
  const destinationHash = trimmed.slice(0, addressEnd).trim();
  const path = trimmed.slice(addressEnd + (separator >= 0 ? 1 : 0)).trim() || '/';
  if (!/^[0-9a-f]{32}$/i.test(destinationHash)) return undefined;
  return {
    destinationHash: destinationHash.toLowerCase(),
    path: path.startsWith('/') ? path : `/${path}`,
    requestData: nomadRequestVariables(fieldSpec),
  };
}

export function nomadRequestPath(path: string): string {
  const normalized = path.trim();
  if (!normalized || normalized === '/') return NOMAD_DEFAULT_PAGE_PATH;
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

/**
 * Reticulum request events expose the response as one raw MessagePack value.
 * NomadNet page handlers return either bytes (MessagePack bin) or text
 * (MessagePack str), so unwrap that value before UTF-8 decoding.
 */
export function unpackNomadPageResponse(response: Uint8Array): Uint8Array | undefined {
  if (response.byteLength === 0) return undefined;
  const marker = response[0];
  let payloadOffset: number;
  let payloadLength: number;

  if ((marker & 0xe0) === 0xa0) {
    payloadOffset = 1;
    payloadLength = marker & 0x1f;
  } else if (marker === 0xc4 || marker === 0xd9) {
    if (response.byteLength < 2) return undefined;
    payloadOffset = 2;
    payloadLength = response[1];
  } else if (marker === 0xc5 || marker === 0xda) {
    if (response.byteLength < 3) return undefined;
    payloadOffset = 3;
    payloadLength = new DataView(response.buffer, response.byteOffset + 1, 2).getUint16(0);
  } else if (marker === 0xc6 || marker === 0xdb) {
    if (response.byteLength < 5) return undefined;
    payloadOffset = 5;
    payloadLength = new DataView(response.buffer, response.byteOffset + 1, 4).getUint32(0);
  } else {
    return undefined;
  }

  if (payloadOffset + payloadLength !== response.byteLength) return undefined;
  return response.slice(payloadOffset);
}

export function resolveNomadLink(
  currentDestinationHash: string,
  target: string,
): { destinationHash: string; path: string; requestData: NomadRequestData } | undefined {
  let normalized = target.trim();
  if (!normalized) return undefined;
  if (/^lxmf:\/\//i.test(normalized) || /^lxmf@/i.test(normalized)) return undefined;
  normalized = normalized.replace(/^nomadnetwork:\/\//i, '').replace(/^nnn@/i, '');
  if (/^\/[0-9a-f]{32}(?=[:/]|$)/i.test(normalized)) normalized = normalized.slice(1);
  if (normalized.startsWith(':')) normalized = `${currentDestinationHash}${normalized}`;
  else if (normalized.startsWith('/')) normalized = `${currentDestinationHash}:${normalized}`;
  return parseNomadAddress(normalized);
}

export function nomadRequestVariables(fieldSpec: string | undefined): NomadRequestData {
  const requestData: NomadRequestData = {};
  if (!fieldSpec) return requestData;
  for (const entry of fieldSpec.split('|')) {
    const components = entry.split('=');
    if (components.length !== 2) continue;
    requestData[`var_${components[0]}`] = components[1];
  }
  return requestData;
}

export function encodeNomadRequestData(requestData: NomadRequestData): Uint8Array {
  const entries = Object.entries(requestData);
  const output: number[] = [];
  if (entries.length <= 0x0f) output.push(0x80 | entries.length);
  else if (entries.length <= 0xffff) output.push(0xde, entries.length >> 8, entries.length & 0xff);
  else throw new RangeError('NomadNet request data contains too many fields');
  for (const [key, value] of entries) {
    appendMessagePackString(output, key);
    appendMessagePackString(output, value);
  }
  return Uint8Array.from(output);
}

function splitNomadFieldSpec(value: string): [string, string | undefined] {
  const separator = value.indexOf('`');
  return separator < 0
    ? [value, undefined]
    : [value.slice(0, separator), value.slice(separator + 1)];
}

function appendMessagePackString(output: number[], value: string): void {
  const bytes = new TextEncoder().encode(value);
  if (bytes.length <= 0x1f) output.push(0xa0 | bytes.length);
  else if (bytes.length <= 0xff) output.push(0xd9, bytes.length);
  else if (bytes.length <= 0xffff) output.push(0xda, bytes.length >> 8, bytes.length & 0xff);
  else output.push(
    0xdb,
    (bytes.length >>> 24) & 0xff,
    (bytes.length >>> 16) & 0xff,
    (bytes.length >>> 8) & 0xff,
    bytes.length & 0xff,
  );
  output.push(...bytes);
}

export function nomadLinkFragment(target: string): string | undefined {
  let normalized = target.trim().replace(/^nomadnetwork:\/\//i, '');
  normalized = normalized.split('`', 1)[0].replace(/^\/+/, '');
  if (normalized.startsWith(':#')) normalized = normalized.slice(1);
  if (!normalized.startsWith('#') || normalized.length === 1) return undefined;
  try {
    return decodeURIComponent(normalized.slice(1));
  } catch {
    return normalized.slice(1);
  }
}
