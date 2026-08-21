import { interfaceNetworkFingerprint } from '../../domain/interface-announce';
import type { InterfaceConfig } from '../../domain/settings';
import type { RuntimeInterfaceBinding } from './path-interface-transition';

const checkpointVersion = 1;

interface StablePersistentPath {
  interfaceId: string;
  networkFingerprint: string;
  path: Record<string, unknown>;
}

interface StableNetworkCheckpoint {
  retivumNetworkCheckpointVersion: number;
  networkState: Record<string, unknown>;
  paths: StablePersistentPath[];
}

export interface RestoredNetworkCheckpoint {
  snapshot: Record<string, unknown>;
  discarded: number;
  needsPersistence: boolean;
}

/**
 * Removes process-local Leviculum interface indexes from durable path state.
 * The encrypted host checkpoint owns the stable interface association and
 * recreates a numeric index only when a specific runtime is restored.
 */
export function createStableNetworkCheckpoint(
  snapshot: Record<string, unknown>,
  bindings: readonly RuntimeInterfaceBinding[],
): StableNetworkCheckpoint {
  const bindingByRuntimeIndex = new Map(bindings.map((binding) => [binding.runtimeIndex, binding]));
  const paths = arrayRecords(snapshot.paths).flatMap((path): StablePersistentPath[] => {
    const runtimeIndex = fieldRuntimeIndex(path);
    const binding = runtimeIndex === undefined ? undefined : bindingByRuntimeIndex.get(runtimeIndex);
    if (!binding) return [];
    const stablePath = { ...path };
    delete stablePath.interfaceIndex;
    delete stablePath.interface_index;
    return [{
      interfaceId: binding.interfaceId,
      networkFingerprint: binding.networkFingerprint,
      path: stablePath,
    }];
  });
  return {
    retivumNetworkCheckpointVersion: checkpointVersion,
    networkState: { ...snapshot, paths: [] },
    paths,
  };
}

/**
 * Restores paths only when their stable interface and material network are
 * still present. Numeric-only legacy paths are discarded because an index
 * collision cannot be distinguished from a valid association.
 */
export function restoreStableNetworkCheckpoint(
  value: unknown,
  interfaces: readonly InterfaceConfig[],
): RestoredNetworkCheckpoint {
  if (!isStableNetworkCheckpoint(value)) {
    if (
      value
      && typeof value === 'object'
      && 'retivumNetworkCheckpointVersion' in value
    ) throw new Error('RUNTIME_NETWORK_CHECKPOINT_INVALID');
    const legacy = record(value);
    const discarded = arrayRecords(legacy.paths).length;
    return {
      snapshot: { ...legacy, paths: [] },
      discarded,
      needsPersistence: true,
    };
  }

  const nextByInterfaceId = new Map<string, { runtimeIndex: number; networkFingerprint: string }>();
  let runtimeIndex = 0;
  for (const config of interfaces) {
    if (!config.enabled) continue;
    nextByInterfaceId.set(config.id, {
      runtimeIndex,
      networkFingerprint: interfaceNetworkFingerprint(config),
    });
    runtimeIndex += 1;
  }

  let discarded = 0;
  const paths = value.paths.flatMap((entry) => {
    const next = nextByInterfaceId.get(entry.interfaceId);
    if (!next || next.networkFingerprint !== entry.networkFingerprint) {
      discarded += 1;
      return [];
    }
    return [{ ...entry.path, interfaceIndex: next.runtimeIndex }];
  });
  return {
    snapshot: { ...value.networkState, paths },
    discarded,
    needsPersistence: discarded > 0,
  };
}

function isStableNetworkCheckpoint(value: unknown): value is StableNetworkCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const source = value as Partial<StableNetworkCheckpoint>;
  return source.retivumNetworkCheckpointVersion === checkpointVersion
    && Boolean(source.networkState && typeof source.networkState === 'object')
    && Array.isArray(source.paths)
    && source.paths.every((entry) => (
      Boolean(entry && typeof entry === 'object')
      && typeof entry.interfaceId === 'string'
      && typeof entry.networkFingerprint === 'string'
      && Boolean(entry.path && typeof entry.path === 'object')
    ));
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === 'object'))
    : [];
}

function fieldRuntimeIndex(path: Record<string, unknown>): number | undefined {
  const value = path.interfaceIndex ?? path.interface_index;
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'bigint' && value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  return undefined;
}
