import type { InterfaceConfig } from './settings';

export interface InterfaceAnnounceHistoryRecord {
  id: string;
  schemaVersion: 1;
  identityId: string;
  interfaceId: string;
  networkFingerprint: string;
  destinationHash: string;
  announceFingerprint: string;
  lastAnnouncedAt: string;
}

export interface AnnouncePacketMetadata {
  packetType?: string;
  destinationHash?: Uint8Array | number[];
}

export function interfaceNetworkFingerprint(config: InterfaceConfig): string {
  const ifac = {
    enabled: Boolean(config.ifac.networkName || config.ifac.passphrase),
    networkName: config.ifac.networkName,
    sizeBytes: config.ifac.sizeBytes,
    credentialRevision: config.ifac.passphrase ? config.ifac.credentialRevision : undefined,
  };
  if (config.type === 'websocket') {
    return JSON.stringify({
      version: 1,
      type: config.type,
      mode: config.mode,
      scheme: config.connection.scheme,
      host: config.connection.host,
      port: config.connection.port,
      path: config.connection.path,
      ifac,
    });
  }
  if (config.type === 'tcp') {
    return JSON.stringify({
      version: 1,
      type: config.type,
      mode: config.mode,
      host: config.connection.host,
      port: config.connection.port,
      ifac,
    });
  }
  if (config.type === 'udp') {
    return JSON.stringify({
      version: 1,
      type: config.type,
      mode: config.mode,
      listenHost: config.connection.listenHost,
      listenPort: config.connection.listenPort,
      forwardHost: config.connection.forwardHost,
      forwardPort: config.connection.forwardPort,
      ifac,
    });
  }
  return JSON.stringify({
    version: 1,
    type: config.type,
    mode: config.mode,
    connectionType: config.connection.type,
    deviceId: config.connection.deviceId,
    usbVendorId: config.connection.usbVendorId,
    usbProductId: config.connection.usbProductId,
    frequency: config.radio.frequency,
    bandwidth: config.radio.bandwidth,
    txPower: config.radio.txPower,
    spreadingFactor: config.radio.spreadingFactor,
    codingRate: config.radio.codingRate,
    dutyCycle: config.radio.dutyCycle,
    flowControl: config.radio.flowControl,
    ifac,
  });
}

export function interfaceAnnounceHistoryId(
  identityId: string,
  interfaceId: string,
  networkFingerprint: string,
  destinationHash: string,
): string {
  return JSON.stringify([identityId, interfaceId, networkFingerprint, destinationHash]);
}

export function createInterfaceAnnounceHistoryRecord(
  identityId: string,
  interfaceId: string,
  networkFingerprint: string,
  destinationHash: string,
  announceFingerprint: string,
  lastAnnouncedAt: string,
): InterfaceAnnounceHistoryRecord {
  return {
    id: interfaceAnnounceHistoryId(identityId, interfaceId, networkFingerprint, destinationHash),
    schemaVersion: 1,
    identityId,
    interfaceId,
    networkFingerprint,
    destinationHash,
    announceFingerprint,
    lastAnnouncedAt,
  };
}

export function lxmfDeliveryAnnounceFingerprint(
  displayName: string,
  inboundStampCost: number,
): string {
  return JSON.stringify({
    version: 1,
    displayName,
    stampCost: inboundStampCost > 0 ? inboundStampCost : null,
    compressionSupported: true,
  });
}

export function hasCurrentInterfaceAnnounce(
  record: InterfaceAnnounceHistoryRecord | undefined,
  announceFingerprint: string,
): boolean {
  return record?.announceFingerprint === announceFingerprint;
}

export function latestDestinationAnnouncedAt(
  records: Iterable<InterfaceAnnounceHistoryRecord>,
  identityId: string,
  destinationHash: string,
): string | undefined {
  const normalizedDestinationHash = destinationHash.toLowerCase();
  let latestAt: string | undefined;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const record of records) {
    if (
      record.identityId !== identityId
      || record.destinationHash !== normalizedDestinationHash
    ) continue;
    const announcedMs = Date.parse(record.lastAnnouncedAt);
    if (!Number.isFinite(announcedMs) || announcedMs <= latestMs) continue;
    latestAt = record.lastAnnouncedAt;
    latestMs = announcedMs;
  }
  return latestAt;
}

export function normalizeInterfaceAnnounceHistoryRecord(
  value: unknown,
): InterfaceAnnounceHistoryRecord | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<InterfaceAnnounceHistoryRecord>;
  if (
    typeof source.identityId !== 'string'
    || !source.identityId
    || typeof source.interfaceId !== 'string'
    || !source.interfaceId
    || typeof source.networkFingerprint !== 'string'
    || !source.networkFingerprint
    || typeof source.destinationHash !== 'string'
    || !/^[0-9a-f]{32}$/i.test(source.destinationHash)
    || typeof source.announceFingerprint !== 'string'
    || !source.announceFingerprint
    || typeof source.lastAnnouncedAt !== 'string'
    || !Number.isFinite(Date.parse(source.lastAnnouncedAt))
  ) return undefined;
  const destinationHash = source.destinationHash.toLowerCase();
  return createInterfaceAnnounceHistoryRecord(
    source.identityId,
    source.interfaceId,
    source.networkFingerprint,
    destinationHash,
    source.announceFingerprint,
    source.lastAnnouncedAt,
  );
}

export function announcePacketDestinationHash(
  packet: AnnouncePacketMetadata,
): string | undefined {
  if (!packet.destinationHash) return undefined;
  const bytes = Array.from(packet.destinationHash);
  if (bytes.length !== 16 || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) {
    return undefined;
  }
  return bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function shouldSuppressInterfaceOnlineAnnounce(
  packet: AnnouncePacketMetadata,
): boolean {
  // Leviculum may announce every local IN destination when an interface goes
  // online. Retivum owns reconnect timing and LXMF application data, so none
  // of those implicit announces may leave the worker.
  return packet.packetType === 'announce';
}
