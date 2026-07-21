import type { InterfaceConfig } from '../../domain/settings';
import type { ProbeResult } from './protocol';

export type ProbeRouteDetails = Pick<ProbeResult, 'viaHash' | 'interfaceName' | 'interfaceType'>;

export function resolveProbeRoute(
  snapshot: unknown,
  destinationHash: string,
  interfaces: readonly InterfaceConfig[],
  stableInterfaceId: (runtimeId: number | undefined) => string | undefined,
): ProbeRouteDetails {
  if (!snapshot || typeof snapshot !== 'object') return {};
  const paths = (snapshot as Record<string, unknown>).paths;
  if (!Array.isArray(paths)) return {};

  const path = paths.find((value) => {
    if (!value || typeof value !== 'object') return false;
    const hash = fieldBytes(value as Record<string, unknown>, 'destinationHash');
    return hash?.byteLength === 16 && bytesToHex(hash) === destinationHash;
  });
  if (!path || typeof path !== 'object') return {};

  const record = path as Record<string, unknown>;
  const nextHop = fieldBytes(record, 'nextHop');
  const runtimeId = fieldNumber(record, 'interfaceIndex');
  const interfaceId = stableInterfaceId(runtimeId);
  const interfaceConfig = interfaces.find((item) => item.id === interfaceId);

  return {
    viaHash: nextHop?.byteLength === 16 ? bytesToHex(nextHop) : destinationHash,
    ...(interfaceConfig ? {
      interfaceName: interfaceConfig.name,
      interfaceType: interfaceConfig.type,
    } : {}),
  };
}

function fieldBytes(record: Record<string, unknown>, camelName: string): Uint8Array | undefined {
  const value = field(record, camelName);
  if (value === undefined || value === null) return undefined;
  try {
    return value instanceof Uint8Array ? value : new Uint8Array(value as ArrayLike<number>);
  } catch {
    return undefined;
  }
}

function fieldNumber(record: Record<string, unknown>, camelName: string): number | undefined {
  const value = field(record, camelName);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value);
  return undefined;
}

function field(record: Record<string, unknown>, camelName: string): unknown {
  const snakeName = camelName.replace(/[A-Z]/g, (character) => `_${character.toLowerCase()}`);
  return record[camelName] ?? record[snakeName];
}

function bytesToHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
