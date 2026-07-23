export interface AnnouncePacketMetadata {
  packetType?: string;
  destinationHash?: Uint8Array | number[];
}

function destinationHashHex(destinationHash: Uint8Array | number[]): string {
  return Array.from(destinationHash, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isSuppressedAnnounce(
  packet: AnnouncePacketMetadata,
  suppressedDestinationHashes: ReadonlySet<string> | undefined,
): boolean {
  return packet.packetType === 'announce'
    && packet.destinationHash !== undefined
    && suppressedDestinationHashes?.has(destinationHashHex(packet.destinationHash)) === true;
}
