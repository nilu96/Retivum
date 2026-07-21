export const provisioningOperations = {
  getSchema: 1,
  getInfo: 2,
  getCapabilities: 3,
  getState: 4,
  setState: 5,
  commit: 6,
  discard: 7,
  factoryReset: 8,
  reboot: 9,
  acknowledgement: 100,
  error: 101,
} as const;

export const provisioningFieldTypes = {
  none: 0,
  boolean: 1,
  integer: 2,
  float: 3,
  string: 4,
  bytes: 5,
  enumeration: 6,
  bytesList: 7,
  void: 8,
} as const;

export const provisioningFieldFlags = {
  liveApply: 1,
  rebootRequired: 2,
  readOnly: 4,
  secret: 8,
  writeOnly: 16,
} as const;

const fieldKeys = {
  id: 1,
  name: 2,
  type: 3,
  flags: 4,
  minInteger: 5,
  maxInteger: 6,
  minFloat: 7,
  maxFloat: 8,
  maxLength: 9,
  enumValues: 10,
  enumLabels: 11,
  defaultValue: 12,
  elementSize: 13,
  maxCount: 14,
} as const;

const infoKeys = { firmwareVersion: 1, schemaVersion: 2, needsReboot: 3, schemaHash: 4 } as const;
const wireKeys = { requestCompression: 100, compressedPayload: 101 } as const;
const getStateKeys = { namespaceFilter: 1, pending: 2 } as const;
const setStateKeys = { applied: 1, draftHasReboot: 2, fieldErrors: 3 } as const;
const commitKeys = { applied: 1, needsReboot: 2 } as const;
const errorKeys = { code: 1, message: 2, namespace: 3, field: 4 } as const;

export type ProvisioningValue = null | boolean | number | bigint | string | Uint8Array | ProvisioningValue[] | Map<ProvisioningValue, ProvisioningValue>;

export interface ProvisioningField {
  id: number;
  name: string;
  type: number;
  flags: number;
  minInteger?: number;
  maxInteger?: number;
  minFloat?: number;
  maxFloat?: number;
  maxLength?: number;
  enumValues?: ProvisioningValue[];
  enumLabels?: string[];
  defaultValue?: ProvisioningValue;
  elementSize?: number;
  maxCount?: number;
}

export interface ProvisioningNamespace {
  id: number;
  name: string;
  parentId: number;
  fields: ProvisioningField[];
}

export interface ProvisioningSchema {
  namespaces: ProvisioningNamespace[];
}

export interface ProvisioningInfo {
  firmwareVersion?: string;
  schemaVersion?: number;
  schemaHash?: number;
  needsReboot: boolean;
}

export interface ProvisioningNode {
  id: string;
  destinationHash: string;
  publicKey: string;
  interfaceId?: string;
  hops?: number;
  heardAt: string;
  bookmarked?: boolean;
  label?: string;
}

export interface CachedProvisioningSchema {
  id: string;
  schemaVersion: number;
  schemaHash: number;
  schema: ProvisioningSchema;
  cachedAt: string;
}

export type ProvisioningState = Record<number, Record<number, ProvisioningValue>>;

export interface ProvisioningEnvelope {
  operation: number;
  sequence: number;
  body: ProvisioningValue;
}

export interface ProvisioningErrorDetails {
  code: number;
  message: string;
  namespace?: number;
  field?: number;
}

export class ProvisioningProtocolError extends Error {
  constructor(readonly details: ProvisioningErrorDetails) {
    super(details.message);
    this.name = 'ProvisioningProtocolError';
  }
}

class MessagePackWriter {
  private readonly chunks: Uint8Array[] = [];
  private size = 0;

  private push(value: Uint8Array): void {
    this.chunks.push(value);
    this.size += value.length;
  }

  private byte(value: number): void { this.push(Uint8Array.of(value & 0xff)); }
  private uint16(value: number): void { this.push(Uint8Array.of((value >> 8) & 0xff, value & 0xff)); }
  private uint32(value: number): void {
    this.push(Uint8Array.of((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff));
  }
  private uint64(value: bigint): void {
    const bytes = new Uint8Array(8);
    for (let index = 7; index >= 0; index -= 1) {
      bytes[index] = Number(value & 0xffn);
      value >>= 8n;
    }
    this.push(bytes);
  }

  write(value: ProvisioningValue): void {
    if (value === null) return this.byte(0xc0);
    if (typeof value === 'boolean') return this.byte(value ? 0xc3 : 0xc2);
    if (typeof value === 'number') {
      if (!Number.isInteger(value)) {
        this.byte(0xcb);
        const data = new DataView(new ArrayBuffer(8));
        data.setFloat64(0, value, false);
        this.push(new Uint8Array(data.buffer));
        return;
      }
      return this.integer(BigInt(value));
    }
    if (typeof value === 'bigint') return this.integer(value);
    if (typeof value === 'string') {
      const bytes = new TextEncoder().encode(value);
      if (bytes.length < 32) this.byte(0xa0 | bytes.length);
      else if (bytes.length < 256) { this.byte(0xd9); this.byte(bytes.length); }
      else if (bytes.length < 65_536) { this.byte(0xda); this.uint16(bytes.length); }
      else { this.byte(0xdb); this.uint32(bytes.length); }
      this.push(bytes);
      return;
    }
    if (value instanceof Uint8Array) {
      if (value.length < 256) { this.byte(0xc4); this.byte(value.length); }
      else if (value.length < 65_536) { this.byte(0xc5); this.uint16(value.length); }
      else { this.byte(0xc6); this.uint32(value.length); }
      this.push(value);
      return;
    }
    if (Array.isArray(value)) {
      if (value.length < 16) this.byte(0x90 | value.length);
      else if (value.length < 65_536) { this.byte(0xdc); this.uint16(value.length); }
      else { this.byte(0xdd); this.uint32(value.length); }
      value.forEach((item) => this.write(item));
      return;
    }
    if (value instanceof Map) {
      if (value.size < 16) this.byte(0x80 | value.size);
      else if (value.size < 65_536) { this.byte(0xde); this.uint16(value.size); }
      else { this.byte(0xdf); this.uint32(value.size); }
      for (const [key, item] of value) {
        this.write(key);
        this.write(item);
      }
      return;
    }
    throw new Error('PROVISIONING_MSGPACK_UNSUPPORTED_VALUE');
  }

  result(): Uint8Array {
    const result = new Uint8Array(this.size);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  private integer(value: bigint): void {
    if (value >= 0n) {
      if (value < 128n) this.byte(Number(value));
      else if (value < 256n) { this.byte(0xcc); this.byte(Number(value)); }
      else if (value < 65_536n) { this.byte(0xcd); this.uint16(Number(value)); }
      else if (value < 4_294_967_296n) { this.byte(0xce); this.uint32(Number(value)); }
      else { this.byte(0xcf); this.uint64(value); }
      return;
    }
    if (value >= -32n) this.byte(Number(value) & 0xff);
    else if (value >= -128n) { this.byte(0xd0); this.byte(Number(value) & 0xff); }
    else if (value >= -32_768n) { this.byte(0xd1); this.uint16(Number(value) & 0xffff); }
    else if (value >= -2_147_483_648n) { this.byte(0xd2); this.uint32(Number(value) >>> 0); }
    else { this.byte(0xd3); this.uint64(value + (1n << 64n)); }
  }
}

class MessagePackReader {
  private offset = 0;
  private readonly decoder = new TextDecoder();
  private static readonly maximumDepth = 64;

  constructor(private readonly bytes: Uint8Array) {}

  read(depth = 0): ProvisioningValue {
    if (depth > MessagePackReader.maximumDepth) throw new Error('PROVISIONING_MSGPACK_TOO_DEEP');
    const type = this.uint8();
    if (type <= 0x7f) return type;
    if (type >= 0xe0) return type - 0x100;
    if ((type & 0xe0) === 0xa0) return this.decoder.decode(this.take(type & 0x1f));
    if ((type & 0xf0) === 0x90) return this.array(type & 0x0f, depth + 1);
    if ((type & 0xf0) === 0x80) return this.map(type & 0x0f, depth + 1);
    switch (type) {
      case 0xc0: return null;
      case 0xc2: return false;
      case 0xc3: return true;
      case 0xc4: return this.take(this.uint8());
      case 0xc5: return this.take(this.uint16());
      case 0xc6: return this.take(this.uint32());
      case 0xca: return this.float32();
      case 0xcb: return this.float64();
      case 0xcc: return this.uint8();
      case 0xcd: return this.uint16();
      case 0xce: return this.uint32();
      case 0xcf: return this.safeInteger(this.uint64());
      case 0xd0: { const value = this.uint8(); return value < 128 ? value : value - 256; }
      case 0xd1: { const value = this.uint16(); return value < 32_768 ? value : value - 65_536; }
      case 0xd2: { const value = this.uint32(); return value < 2_147_483_648 ? value : value - 4_294_967_296; }
      case 0xd3: {
        let value = this.uint64();
        if (value >= (1n << 63n)) value -= 1n << 64n;
        return this.safeInteger(value);
      }
      case 0xd9: return this.decoder.decode(this.take(this.uint8()));
      case 0xda: return this.decoder.decode(this.take(this.uint16()));
      case 0xdb: return this.decoder.decode(this.take(this.uint32()));
      case 0xdc: return this.array(this.uint16(), depth + 1);
      case 0xdd: return this.array(this.uint32(), depth + 1);
      case 0xde: return this.map(this.uint16(), depth + 1);
      case 0xdf: return this.map(this.uint32(), depth + 1);
      default: throw new Error(`PROVISIONING_MSGPACK_UNSUPPORTED_TYPE_${type.toString(16)}`);
    }
  }

  private ensure(length: number): void {
    if (this.offset + length > this.bytes.length) throw new Error('PROVISIONING_MSGPACK_TRUNCATED');
  }
  private uint8(): number { this.ensure(1); return this.bytes[this.offset++]; }
  private uint16(): number {
    this.ensure(2);
    const result = (this.bytes[this.offset] << 8) | this.bytes[this.offset + 1];
    this.offset += 2;
    return result >>> 0;
  }
  private uint32(): number {
    this.ensure(4);
    const result = this.bytes[this.offset] * 0x1000000
      + ((this.bytes[this.offset + 1] << 16) | (this.bytes[this.offset + 2] << 8) | this.bytes[this.offset + 3]);
    this.offset += 4;
    return result >>> 0;
  }
  private uint64(): bigint {
    this.ensure(8);
    let result = 0n;
    for (let index = 0; index < 8; index += 1) result = (result << 8n) | BigInt(this.bytes[this.offset + index]);
    this.offset += 8;
    return result;
  }
  private float32(): number {
    this.ensure(4);
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 4).getFloat32(0, false);
    this.offset += 4;
    return value;
  }
  private float64(): number {
    this.ensure(8);
    const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 8).getFloat64(0, false);
    this.offset += 8;
    return value;
  }
  private take(length: number): Uint8Array {
    this.ensure(length);
    const value = this.bytes.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }
  finished(): boolean { return this.offset === this.bytes.length; }
  private array(length: number, depth: number): ProvisioningValue[] {
    if (length > this.bytes.length - this.offset) throw new Error('PROVISIONING_MSGPACK_COLLECTION_TOO_LARGE');
    return Array.from({ length }, () => this.read(depth));
  }
  private map(length: number, depth: number): Map<ProvisioningValue, ProvisioningValue> {
    if (length > Math.floor((this.bytes.length - this.offset) / 2)) {
      throw new Error('PROVISIONING_MSGPACK_COLLECTION_TOO_LARGE');
    }
    const value = new Map<ProvisioningValue, ProvisioningValue>();
    for (let index = 0; index < length; index += 1) value.set(this.read(depth), this.read(depth));
    return value;
  }
  private safeInteger(value: bigint): number | bigint {
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value;
  }
}

export function encodeProvisioningMessage(value: ProvisioningValue): Uint8Array {
  const writer = new MessagePackWriter();
  writer.write(value);
  return writer.result();
}

export function decodeProvisioningMessage(bytes: Uint8Array): ProvisioningValue {
  const reader = new MessagePackReader(bytes);
  const value = reader.read();
  if (!reader.finished()) throw new Error('PROVISIONING_MSGPACK_TRAILING_DATA');
  return value;
}

export function encodeProvisioningRequest(
  operation: number,
  sequence: number,
  payload?: ProvisioningValue,
  requestCompression = true,
): Uint8Array {
  const compressible = operation >= provisioningOperations.getSchema && operation <= provisioningOperations.getState
    || operation === provisioningOperations.factoryReset
    || operation === provisioningOperations.reboot;
  let body = payload;
  if (requestCompression && compressible) {
    if (payload === undefined || payload === null) body = new Map([[wireKeys.requestCompression, true]]);
    else if (payload instanceof Map) body = new Map([...payload, [wireKeys.requestCompression, true]]);
  }
  return encodeProvisioningMessage(body === undefined
    ? [operation, sequence]
    : [operation, sequence, body]);
}

export function decodeProvisioningEnvelope(bytes: Uint8Array): ProvisioningEnvelope {
  const value = decodeProvisioningMessage(bytes);
  if (!Array.isArray(value) || value.length < 2) throw new Error('PROVISIONING_RESPONSE_INVALID');
  let body = value.length >= 3 ? value[2] : null;
  if (body instanceof Map && body.size === 1 && body.has(wireKeys.compressedPayload)) {
    const compressed = body.get(wireKeys.compressedPayload);
    if (!(compressed instanceof Uint8Array)) throw new Error('PROVISIONING_COMPRESSED_RESPONSE_INVALID');
    body = decodeProvisioningMessage(heatshrinkDecode(compressed));
  }
  const envelope = { operation: Number(value[0]), sequence: Number(value[1]), body };
  if (envelope.operation === provisioningOperations.error) {
    const map = asMap(body);
    throw new ProvisioningProtocolError({
      code: Number(map.get(errorKeys.code) ?? 99),
      message: String(map.get(errorKeys.message) ?? 'Provisioning error'),
      namespace: optionalNumber(map.get(errorKeys.namespace)),
      field: optionalNumber(map.get(errorKeys.field)),
    });
  }
  return envelope;
}

export function parseProvisioningInfo(body: ProvisioningValue): ProvisioningInfo {
  const map = asMap(body);
  return {
    firmwareVersion: typeof map.get(infoKeys.firmwareVersion) === 'string' ? map.get(infoKeys.firmwareVersion) as string : undefined,
    schemaVersion: optionalNumber(map.get(infoKeys.schemaVersion)),
    schemaHash: optionalNumber(map.get(infoKeys.schemaHash)),
    needsReboot: map.get(infoKeys.needsReboot) === true,
  };
}

export function parseProvisioningSchema(body: ProvisioningValue): ProvisioningSchema {
  const namespaces: ProvisioningNamespace[] = [];
  if (!Array.isArray(body)) return { namespaces };
  for (const entry of body) {
    if (!Array.isArray(entry) || entry.length < 3) continue;
    const schemaV2 = entry.length >= 4;
    const fieldsRaw = entry[schemaV2 ? 3 : 2];
    const fields: ProvisioningField[] = [];
    if (Array.isArray(fieldsRaw)) {
      for (const raw of fieldsRaw) {
        if (!(raw instanceof Map)) continue;
        fields.push({
          id: Number(raw.get(fieldKeys.id)),
          name: String(raw.get(fieldKeys.name) ?? ''),
          type: Number(raw.get(fieldKeys.type)),
          flags: Number(raw.get(fieldKeys.flags) ?? 0),
          minInteger: optionalNumber(raw.get(fieldKeys.minInteger)),
          maxInteger: optionalNumber(raw.get(fieldKeys.maxInteger)),
          minFloat: optionalNumber(raw.get(fieldKeys.minFloat)),
          maxFloat: optionalNumber(raw.get(fieldKeys.maxFloat)),
          maxLength: optionalNumber(raw.get(fieldKeys.maxLength)),
          enumValues: arrayValue(raw.get(fieldKeys.enumValues)),
          enumLabels: arrayValue(raw.get(fieldKeys.enumLabels))?.map(String),
          defaultValue: raw.get(fieldKeys.defaultValue),
          elementSize: optionalNumber(raw.get(fieldKeys.elementSize)),
          maxCount: optionalNumber(raw.get(fieldKeys.maxCount)),
        });
      }
    }
    namespaces.push({
      id: Number(entry[0]),
      name: String(entry[1]),
      parentId: schemaV2 ? Number(entry[2] ?? 0) : 0,
      fields,
    });
  }
  return { namespaces };
}

export function parseProvisioningState(body: ProvisioningValue): ProvisioningState {
  const state: ProvisioningState = {};
  if (!(body instanceof Map)) return state;
  for (const [namespaceId, rawFields] of body) {
    if (!(rawFields instanceof Map)) continue;
    const fields: Record<number, ProvisioningValue> = {};
    for (const [fieldId, value] of rawFields) fields[Number(fieldId)] = value;
    state[Number(namespaceId)] = fields;
  }
  return state;
}

export function provisioningStatePayload(state: ProvisioningState): ProvisioningValue {
  return new Map(Object.entries(state).map(([namespaceId, fields]) => [
    Number(namespaceId),
    new Map(Object.entries(fields).map(([fieldId, value]) => [Number(fieldId), value])),
  ]));
}

export function parseSetStateResult(body: ProvisioningValue): { applied: number; draftHasReboot: boolean; fieldErrors: Array<{ namespace: number; field: number; code: number }> } {
  const map = asMap(body);
  const errors = map.get(setStateKeys.fieldErrors);
  return {
    applied: Number(map.get(setStateKeys.applied) ?? 0),
    draftHasReboot: map.get(setStateKeys.draftHasReboot) === true,
    fieldErrors: Array.isArray(errors) ? errors.flatMap((entry) => (
      Array.isArray(entry) && entry.length >= 3
        ? [{ namespace: Number(entry[0]), field: Number(entry[1]), code: Number(entry[2]) }]
        : []
    )) : [],
  };
}

export function parseCommitResult(body: ProvisioningValue): { applied: number; needsReboot: boolean } {
  const map = asMap(body);
  return { applied: Number(map.get(commitKeys.applied) ?? 0), needsReboot: map.get(commitKeys.needsReboot) === true };
}

export function heatshrinkDecode(
  input: Uint8Array,
  windowBits = 9,
  lookaheadBits = 4,
  maximumOutputBytes = 4 * 1024 * 1024,
): Uint8Array {
  const output: number[] = [];
  let bitPosition = 0;
  const totalBits = input.length * 8;
  const readBits = (count: number): number => {
    if (bitPosition + count > totalBits) return -1;
    let value = 0;
    for (let index = 0; index < count; index += 1) {
      value = (value << 1) | ((input[bitPosition >> 3] >> (7 - (bitPosition & 7))) & 1);
      bitPosition += 1;
    }
    return value;
  };
  while (bitPosition < totalBits) {
    const tag = readBits(1);
    if (tag < 0) break;
    if (tag === 1) {
      const value = readBits(8);
      if (value < 0) break;
      if (output.length >= maximumOutputBytes) throw new Error('PROVISIONING_COMPRESSED_RESPONSE_TOO_LARGE');
      output.push(value);
      continue;
    }
    const offsetRaw = readBits(windowBits);
    const lengthRaw = readBits(lookaheadBits);
    if (offsetRaw < 0 || lengthRaw < 0) break;
    const start = output.length - offsetRaw - 1;
    for (let index = 0; index < lengthRaw + 1; index += 1) {
      if (output.length >= maximumOutputBytes) throw new Error('PROVISIONING_COMPRESSED_RESPONSE_TOO_LARGE');
      const source = start + index;
      output.push(source < 0 ? 0 : output[source]);
    }
  }
  return new Uint8Array(output);
}

function asMap(value: ProvisioningValue): Map<ProvisioningValue, ProvisioningValue> {
  return value instanceof Map ? value : new Map();
}

function optionalNumber(value: ProvisioningValue | undefined): number | undefined {
  return typeof value === 'number' ? value : typeof value === 'bigint' ? Number(value) : undefined;
}

function arrayValue(value: ProvisioningValue | undefined): ProvisioningValue[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function getStatePayload(namespaceIds?: number[], pending = false): ProvisioningValue {
  const payload = new Map<ProvisioningValue, ProvisioningValue>();
  if (namespaceIds?.length) payload.set(getStateKeys.namespaceFilter, namespaceIds);
  if (pending) payload.set(getStateKeys.pending, true);
  return payload.size ? payload : null;
}

export function namespaceListPayload(namespaceIds?: number[]): ProvisioningValue {
  return namespaceIds?.length ? namespaceIds : null;
}
