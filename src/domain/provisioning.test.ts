import { describe, expect, it } from 'vitest';
import {
  decodeProvisioningEnvelope,
  decodeProvisioningMessage,
  encodeProvisioningRequest,
  heatshrinkDecode,
  parseProvisioningInfo,
  parseProvisioningSchema,
  parseProvisioningState,
  provisioningOperations,
  type ProvisioningValue,
} from './provisioning';

describe('provisioning protocol', () => {
  it('encodes the firmware envelope with integer map keys and compression negotiation', () => {
    expect(Array.from(encodeProvisioningRequest(provisioningOperations.getInfo, 1))).toEqual([
      0x93, 0x02, 0x01, 0x81, 0x64, 0xc3,
    ]);
  });

  it('decodes info, schema v2 and state maps without coercing numeric keys', () => {
    const info = parseProvisioningInfo(new Map<ProvisioningValue, ProvisioningValue>([
      [1, '1.2.3'], [2, 7], [3, true], [4, 0x12345678],
    ]));
    expect(info).toEqual({
      firmwareVersion: '1.2.3',
      schemaVersion: 7,
      needsReboot: true,
      schemaHash: 0x12345678,
    });

    const schema = parseProvisioningSchema([
      [4, 'Radio', 1, [new Map<ProvisioningValue, ProvisioningValue>([[1, 2], [2, 'Frequency'], [3, 2], [4, 0], [5, 100], [6, 200]])]],
    ]);
    expect(schema.namespaces[0]).toMatchObject({ id: 4, name: 'Radio', parentId: 1 });
    expect(schema.namespaces[0].fields[0]).toMatchObject({
      id: 2,
      name: 'Frequency',
      type: 2,
      minInteger: 100,
      maxInteger: 200,
    });

    expect(parseProvisioningState(new Map([[4, new Map([[2, 144_800_000]])]]))).toEqual({
      4: { 2: 144_800_000 },
    });
  });

  it('decodes compressed response sentinels used by LoRa provisioning', () => {
    const uncompressed = Uint8Array.of(0x81, 0x01, 0xa3, 0x31, 0x2e, 0x30);
    const compressed = literalHeatshrink(uncompressed);
    expect(heatshrinkDecode(compressed)).toEqual(uncompressed);

    const response = Uint8Array.of(
      0x93, 0x64, 0x09, 0x81, 0x65,
      0xc4, compressed.length,
      ...compressed,
    );
    const envelope = decodeProvisioningEnvelope(response);
    expect(envelope.operation).toBe(100);
    expect(envelope.sequence).toBe(9);
    expect(decodeProvisioningMessage(uncompressed)).toEqual(envelope.body);
  });

  it('rejects trailing MessagePack data and oversized decompression output', () => {
    expect(() => decodeProvisioningMessage(Uint8Array.of(0xc0, 0xc0))).toThrow('PROVISIONING_MSGPACK_TRAILING_DATA');
    expect(() => heatshrinkDecode(literalHeatshrink(Uint8Array.of(1, 2, 3)), 9, 4, 2))
      .toThrow('PROVISIONING_COMPRESSED_RESPONSE_TOO_LARGE');
  });
});

function literalHeatshrink(bytes: Uint8Array): Uint8Array {
  const bits: number[] = [];
  for (const byte of bytes) {
    bits.push(1);
    for (let bit = 7; bit >= 0; bit -= 1) bits.push((byte >> bit) & 1);
  }
  const result = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, index) => { result[index >> 3] |= bit << (7 - (index & 7)); });
  return result;
}
