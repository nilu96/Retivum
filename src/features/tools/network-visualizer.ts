import type { ChatContact } from '../../domain/chat';
import type { IdentitySummary } from '../../domain/identity';
import type { KnownDestinationRecord, KnownFullDestinationName } from '../../domain/known-destination';
import type { InterfaceConfig } from '../../domain/settings';
import type {
  InterfaceRuntimeState,
  KnownDestinationEntry,
  PathTableEntry,
} from '../../infrastructure/reticulum/protocol';
import {
  knownDestinationPresentations,
  type KnownDestinationPresentation,
} from './known-destinations';
import { settleNetworkVisualizerLayout } from './network-force-layout';

export const networkVisualizerPathLimit = 120;

export type NetworkVisualizerNodeKind = 'local' | 'interface' | 'nextHop' | 'destination';
export type NetworkVisualizerEdgeKind = 'interface' | 'direct' | 'route';

export interface NetworkVisualizerNode {
  id: string;
  kind: NetworkVisualizerNodeKind;
  label: string;
  x: number;
  y: number;
  destinationHash?: string;
  identityHash?: string;
  nextHopHash?: string;
  interfaceId?: string;
  interfaceName?: string;
  interfaceType?: InterfaceConfig['type'];
  interfaceState?: InterfaceRuntimeState;
  hops?: number;
  fullDestinationName?: KnownFullDestinationName;
  matched?: boolean;
}

export interface NetworkVisualizerEdge {
  id: string;
  from: string;
  to: string;
  kind: NetworkVisualizerEdgeKind;
  hops?: number;
  matched?: boolean;
}

export interface NetworkVisualizerBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NetworkVisualizerGraph {
  nodes: NetworkVisualizerNode[];
  edges: NetworkVisualizerEdge[];
  pathCount: number;
  hiddenPathCount: number;
  matchedPathCount: number;
  bounds: NetworkVisualizerBounds;
}

export interface NetworkVisualizerInput {
  identity?: IdentitySummary;
  interfaces: readonly InterfaceConfig[];
  interfaceStatuses: Readonly<Record<string, InterfaceRuntimeState>>;
  paths: readonly PathTableEntry[];
  destinations: readonly KnownDestinationRecord[];
  destinationInventory?: readonly KnownDestinationEntry[];
  contacts?: readonly ChatContact[];
  search?: string;
  maximumHops?: number;
  pathLimit?: number;
}

interface VisualizerInterface {
  id: string;
  name: string;
  configured: boolean;
  type?: InterfaceConfig['type'];
  state: InterfaceRuntimeState;
}

interface VisualizerPath {
  path: PathTableEntry;
  interface: VisualizerInterface;
  label: string;
  fullDestinationName?: KnownFullDestinationName;
}

const center = { x: 600, y: 450 };
const fullCircle = Math.PI * 2;
const branchCircleGap = 16;
const leafCircleRadius = 58;
const crowdedLeafThreshold = 8;
const minimumAlternatingLeafScale = .5;
const alternatingLeafScaleStep = .025;
const maximumCrowdedLeafLayers = 12;
const crowdedLayerSpacingSamples = 20;
const networkLayoutCacheLimit = 6;

const minimumBranchRadius: Record<Exclude<NetworkVisualizerNodeKind, 'destination'>, number> = {
  local: 145,
  interface: 110,
  nextHop: 110,
};

const branchNodeCircleRadius: Record<Exclude<NetworkVisualizerNodeKind, 'destination'>, number> = {
  local: 38,
  interface: 31,
  nextHop: 27,
};

interface BranchOrbitLayout {
  radii: Map<string, number>;
  edgeScales: Map<string, number>;
}

interface CrowdedLeafLayout {
  radius: number;
  distances: number[];
}

interface CrowdedLeafPair {
  left: number;
  right: number;
  cosine: number;
  oneMinusCosine: number;
}

const branchLayoutCache = new Map<string, BranchOrbitLayout>();
const settledLayoutCache = new Map<string, ReadonlyMap<string, { x: number; y: number }>>();

function retainRecentCacheEntry<Value>(cache: Map<string, Value>, key: string, value: Value): void {
  cache.delete(key);
  cache.set(key, value);
  const oldestKey = cache.keys().next().value;
  if (cache.size > networkLayoutCacheLimit && oldestKey !== undefined) cache.delete(oldestKey);
}

function abbreviatedHash(value: string): string {
  return value.length <= 15 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function interfaceState(
  config: InterfaceConfig | undefined,
  statuses: Readonly<Record<string, InterfaceRuntimeState>>,
): InterfaceRuntimeState {
  if (config && !config.enabled) return 'disabled';
  return statuses[config?.id ?? ''] ?? 'offline';
}

function destinationLabel(
  destinationHash: string,
  presentation: KnownDestinationPresentation | undefined,
): string {
  return presentation?.localContactName
    || presentation?.displayName
    || abbreviatedHash(destinationHash);
}

function pointOnCircle(angle: number, radius: number): { x: number; y: number } {
  return {
    x: center.x + Math.cos(angle) * radius,
    y: center.y + Math.sin(angle) * radius,
  };
}

function pointFrom(
  parent: { x: number; y: number },
  angle: number,
  radius: number,
): { x: number; y: number } {
  return {
    x: parent.x + Math.cos(angle) * radius,
    y: parent.y + Math.sin(angle) * radius,
  };
}

/**
 * Places a child edge into one of the equally spaced angular slots around a
 * non-root node. The incoming parent edge occupies one slot, so a node with
 * one child has two 180° spokes, two children have three 120° spokes, and so
 * on. `outwardAngle` points from the parent to this node.
 */
function childBranchAngle(outwardAngle: number, index: number, childCount: number): number {
  if (childCount <= 0) return outwardAngle;
  const parentEdgeAngle = outwardAngle + Math.PI;
  const step = fullCircle / (childCount + 1);
  return parentEdgeAngle + step * (index + 1);
}

function topologyNodeKind(nodeId: string): NetworkVisualizerNodeKind {
  if (nodeId === 'local') return 'local';
  if (nodeId.startsWith('interface:')) return 'interface';
  if (nodeId.startsWith('next-hop:')) return 'nextHop';
  return 'destination';
}

function greatestCommonDivisor(left: number, right: number): number {
  let divisor = right;
  let remainder = left;
  while (divisor !== 0) {
    [remainder, divisor] = [divisor, remainder % divisor];
  }
  return remainder;
}

/**
 * Packs a high-degree leaf branch into several concentric rings. For each
 * ring count, coprime layer orders distribute neighbouring spokes across the
 * available radii. Radial spacing is sampled from zero through the complete
 * bubble clearance. The quadratic pair-distance constraint gives the exact
 * smallest base radius for each candidate, so invalid/intersecting candidates
 * are never eligible.
 */
function crowdedLeafLayout(
  childCount: number,
  slotCount: number,
  step: number,
  minimumRadius: number,
): CrowdedLeafLayout {
  const bubbleClearance = leafCircleRadius * 2 + branchCircleGap;
  const maximumLayers = Math.min(
    maximumCrowdedLeafLayers,
    Math.max(2, Math.ceil(Math.sqrt(childCount))),
  );
  let selectedRadius = Number.POSITIVE_INFINITY;
  let selectedDistances: number[] = [];
  const pairs: CrowdedLeafPair[] = [];
  for (let left = 0; left < childCount; left += 1) {
    for (let right = left + 1; right < childCount; right += 1) {
      const slotDistance = Math.min(right - left, slotCount - (right - left));
      const cosine = Math.cos(slotDistance * step);
      pairs.push({ left, right, cosine, oneMinusCosine: 1 - cosine });
    }
  }

  for (let layerCount = 1; layerCount <= maximumLayers; layerCount += 1) {
    const strides = layerCount === 1
      ? [0]
      : Array.from({ length: layerCount - 1 }, (_, index) => index + 1)
        .filter((stride) => greatestCommonDivisor(stride, layerCount) === 1);
    for (const stride of strides) {
      for (let sample = 0; sample <= crowdedLayerSpacingSamples; sample += 1) {
        const layerSpacing = bubbleClearance * sample / crowdedLayerSpacingSamples;
        const offsets = Array.from({ length: childCount }, (_, index) => (
          layerCount === 1 ? 0 : (index * stride % layerCount) * layerSpacing
        ));
        let baseRadius = minimumRadius;
        for (const pair of pairs) {
          const leftOffset = offsets[pair.left];
          const rightOffset = offsets[pair.right];
          const constant = leftOffset ** 2
            + rightOffset ** 2
            - 2 * leftOffset * rightOffset * pair.cosine
            - bubbleClearance ** 2;
          if (constant >= 0) continue;
          const quadratic = 2 * pair.oneMinusCosine;
          const linear = 2 * (leftOffset + rightOffset) * pair.oneMinusCosine;
          const discriminant = linear ** 2 - 4 * quadratic * constant;
          const requiredRadius = (-linear + Math.sqrt(Math.max(0, discriminant)))
            / (2 * quadratic);
          baseRadius = Math.max(baseRadius, requiredRadius);
        }
        const distances = offsets.map((offset) => baseRadius + offset);
        const radius = Math.max(...distances);
        if (radius + .001 < selectedRadius) {
          selectedRadius = radius;
          selectedDistances = distances;
        }
      }
    }
  }

  return { radius: selectedRadius, distances: selectedDistances };
}

/**
 * Recursively sizes every node's own child orbit. Crowded groups may alternate
 * leaf nodes between outer and inner radii. The inner scale is selected by
 * testing candidates rather than fixed: every accepted arrangement keeps all
 * leaf bubbles clear of their parent and each other, and the most compact
 * valid outer radius wins. Children which own another orbit are still placed
 * outside the parent orbit by the sum of both radii and a gap.
 */
function branchOrbitLayout(childrenByParent: ReadonlyMap<string, readonly string[]>): BranchOrbitLayout {
  const radii = new Map<string, number>();
  const edgeScales = new Map<string, number>();
  const visit = (nodeId: string): number => {
    const cached = radii.get(nodeId);
    if (cached !== undefined) return cached;
    const children = childrenByParent.get(nodeId) ?? [];
    if (!children.length) {
      radii.set(nodeId, 0);
      return 0;
    }
    const childOrbitRadii = children.map(visit);
    const childCircleRadii = childOrbitRadii.map((orbitRadius) => (
      orbitRadius > 0 ? orbitRadius : leafCircleRadius
    ));
    const kind = topologyNodeKind(nodeId);
    if (kind === 'destination') {
      radii.set(nodeId, 0);
      return 0;
    }
    const minimumRadius = minimumBranchRadius[kind];
    const slotCount = children.length + (nodeId === 'local' ? 0 : 1);
    const step = fullCircle / Math.max(1, slotCount);
    const leafCount = childOrbitRadii.filter((childRadius) => childRadius === 0).length;
    const scalesFor = (innerScale: number): number[] => {
      let leafIndex = 0;
      return childOrbitRadii.map((childRadius) => {
        if (childRadius > 0) return 1;
        const scale = leafIndex % 2 === 0 ? 1 : innerScale;
        leafIndex += 1;
        return scale;
      });
    };
    const childrenFit = (candidate: number, scales: readonly number[]): boolean => {
      const distances = childOrbitRadii.map((childRadius, index) => (
        childRadius > 0
          ? candidate + childRadius + branchCircleGap
          : candidate * scales[index]
      ));
      for (const [index, childRadius] of childOrbitRadii.entries()) {
        if (childRadius > 0) continue;
        const parentClearance = branchNodeCircleRadius[kind]
          + leafCircleRadius
          + branchCircleGap;
        if (distances[index] + .001 < parentClearance) return false;
      }
      for (let left = 0; left < children.length; left += 1) {
        for (let right = left + 1; right < children.length; right += 1) {
          const slotDistance = Math.min(right - left, slotCount - (right - left));
          const angle = slotDistance * step;
          const centerDistance = Math.sqrt(
            distances[left] ** 2
            + distances[right] ** 2
            - 2 * distances[left] * distances[right] * Math.cos(angle),
          );
          if (centerDistance + .001 < childCircleRadii[left]
            + childCircleRadii[right]
            + branchCircleGap) return false;
        }
      }
      return true;
    };
    const minimumFittingRadius = (scales: readonly number[]): number => {
      if (childrenFit(minimumRadius, scales)) return minimumRadius;
      let upper = minimumRadius;
      while (!childrenFit(upper, scales)) upper *= 2;
      let lower = minimumRadius;
      for (let iteration = 0; iteration < 32; iteration += 1) {
        const candidate = (lower + upper) / 2;
        if (childrenFit(candidate, scales)) upper = candidate;
        else lower = candidate;
      }
      return upper;
    };
    let selectedScales = scalesFor(1);
    let radius = minimumFittingRadius(selectedScales);
    if (leafCount === children.length && leafCount >= crowdedLeafThreshold) {
      const crowdedLayout = crowdedLeafLayout(
        children.length,
        slotCount,
        step,
        minimumRadius,
      );
      radius = crowdedLayout.radius;
      selectedScales = crowdedLayout.distances.map((distance) => distance / radius);
    } else if (leafCount >= crowdedLeafThreshold) {
      for (
        let innerScale = minimumAlternatingLeafScale;
        innerScale < 1;
        innerScale += alternatingLeafScaleStep
      ) {
        const scales = scalesFor(Number(innerScale.toFixed(3)));
        const candidateRadius = minimumFittingRadius(scales);
        if (candidateRadius + .001 < radius) {
          radius = candidateRadius;
          selectedScales = scales;
        }
      }
    }
    for (const [index, childId] of children.entries()) {
      if (selectedScales[index] < 1) {
        edgeScales.set(`${nodeId}\u0000${childId}`, selectedScales[index]);
      }
    }
    radii.set(nodeId, radius);
    return radius;
  };
  visit('local');
  return { radii, edgeScales };
}

function branchLayoutKey(childrenByParent: ReadonlyMap<string, readonly string[]>): string {
  return JSON.stringify(Array.from(childrenByParent));
}

function cachedBranchOrbitLayout(
  childrenByParent: ReadonlyMap<string, readonly string[]>,
): BranchOrbitLayout {
  const key = branchLayoutKey(childrenByParent);
  const cached = branchLayoutCache.get(key);
  if (cached) {
    retainRecentCacheEntry(branchLayoutCache, key, cached);
    return cached;
  }
  const layout = branchOrbitLayout(childrenByParent);
  retainRecentCacheEntry(branchLayoutCache, key, layout);
  return layout;
}

function settledLayoutKey(
  nodes: readonly NetworkVisualizerNode[],
  edges: readonly NetworkVisualizerEdge[],
): string {
  return JSON.stringify([
    nodes.map((node) => [node.id, node.kind, node.label, node.x, node.y]),
    edges.map((edge) => [edge.from, edge.to]),
  ]);
}

function cachedSettledLayout(
  nodes: readonly NetworkVisualizerNode[],
  edges: readonly NetworkVisualizerEdge[],
): NetworkVisualizerNode[] {
  const key = settledLayoutKey(nodes, edges);
  const cached = settledLayoutCache.get(key);
  if (cached) {
    retainRecentCacheEntry(settledLayoutCache, key, cached);
    return nodes.map((node) => {
      const position = cached.get(node.id);
      return position ? { ...node, ...position } : node;
    });
  }
  const settled = settleNetworkVisualizerLayout(nodes, edges);
  retainRecentCacheEntry(settledLayoutCache, key, new Map(settled.map((node) => [
    node.id,
    { x: node.x, y: node.y },
  ])));
  return settled;
}

function branchEdgeLength(
  parentId: string,
  childId: string,
  orbitRadii: ReadonlyMap<string, number>,
  edgeScales: ReadonlyMap<string, number>,
): number {
  const parentRadius = orbitRadii.get(parentId) ?? 0;
  const childRadius = orbitRadii.get(childId) ?? 0;
  if (childRadius > 0) return parentRadius + childRadius + branchCircleGap;
  return parentRadius * (edgeScales.get(`${parentId}\u0000${childId}`) ?? 1);
}

function graphBounds(nodes: readonly NetworkVisualizerNode[]): NetworkVisualizerBounds {
  const horizontalPadding = 170;
  const verticalPadding = 110;
  const minX = Math.min(...nodes.map((node) => node.x), center.x) - horizontalPadding;
  const maxX = Math.max(...nodes.map((node) => node.x), center.x) + horizontalPadding;
  const minY = Math.min(...nodes.map((node) => node.y), center.y) - verticalPadding;
  const maxY = Math.max(...nodes.map((node) => node.y), center.y) + verticalPadding;
  return {
    x: minX,
    y: minY,
    width: Math.max(480, maxX - minX),
    height: Math.max(420, maxY - minY),
  };
}

function searchablePath(path: VisualizerPath): string {
  return [
    path.path.destinationHash,
    path.path.nextHop,
    path.label,
    path.fullDestinationName,
    path.interface.id,
    path.interface.name,
    path.interface.type,
    path.interface.state,
  ].filter(Boolean).join('\n').toLowerCase();
}

function pathKey(path: VisualizerPath): string {
  return `${path.interface.id}:${path.path.destinationHash}`;
}

export function buildNetworkVisualizerGraph(input: NetworkVisualizerInput): NetworkVisualizerGraph {
  const inventory = input.destinationInventory ?? [];
  const inventoryHashes = new Set(inventory.map((entry) => entry.destinationHash));
  const presentationEntries: KnownDestinationEntry[] = [
    ...inventory,
    ...input.paths
      .filter((path) => !inventoryHashes.has(path.destinationHash))
      .map((path) => ({ destinationHash: path.destinationHash })),
  ];
  const destinationPresentations = knownDestinationPresentations(
    presentationEntries,
    input.destinations,
    input.paths,
    input.contacts ?? [],
  );
  const configuredInterfaces = new Map(input.interfaces.map((entry) => [entry.id, entry]));
  const interfaceIds = new Set(input.interfaces.map((entry) => entry.id));
  for (const path of input.paths) interfaceIds.add(path.interfaceId ?? 'unknown');

  const interfaces = Array.from(interfaceIds, (id): VisualizerInterface => {
    const config = configuredInterfaces.get(id);
    return {
      id,
      name: config?.name ?? id,
      configured: config !== undefined,
      type: config?.type,
      state: interfaceState(config, input.interfaceStatuses),
    };
  }).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  const interfacesById = new Map(interfaces.map((entry) => [entry.id, entry]));

  const preparedPaths = input.paths.flatMap((path): VisualizerPath[] => {
    const interfaceEntry = interfacesById.get(path.interfaceId ?? 'unknown');
    if (!interfaceEntry || (input.maximumHops !== undefined && path.hops > input.maximumHops)) return [];
    const presentation = destinationPresentations.get(path.destinationHash);
    return [{
      path,
      interface: interfaceEntry,
      label: destinationLabel(path.destinationHash, presentation),
      fullDestinationName: presentation?.fullDestinationName,
    }];
  });

  const query = input.search?.trim().toLowerCase() ?? '';
  const localMatches = query.length > 0 && [
    input.identity?.displayName,
    input.identity?.identityHashHex,
  ].filter(Boolean).some((value) => value!.toLowerCase().includes(query));
  const pathMatches = (entry: VisualizerPath): boolean => (
    query.length > 0 && (localMatches || searchablePath(entry).includes(query))
  );
  const sortedPaths = preparedPaths.sort((left, right) => (
    (query ? Number(pathMatches(right)) - Number(pathMatches(left)) : 0)
    || left.interface.name.localeCompare(right.interface.name)
    || (left.path.nextHop ?? '').localeCompare(right.path.nextHop ?? '')
    || left.path.hops - right.path.hops
    || left.label.localeCompare(right.label)
    || left.path.destinationHash.localeCompare(right.path.destinationHash)
  ));
  const pathLimit = Math.max(1, input.pathLimit ?? networkVisualizerPathLimit);
  const visiblePaths = sortedPaths.slice(0, pathLimit);
  const matchedPaths = visiblePaths.filter(pathMatches);
  const matchedPathKeys = new Set(matchedPaths.map(pathKey));
  const matchedInterfaceIds = new Set(matchedPaths.map((entry) => entry.interface.id));
  const highlightedInterfaceIds = new Set(matchedInterfaceIds);
  if (query) {
    for (const entry of interfaces) {
      if ([entry.id, entry.name, entry.type, entry.state]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query))) highlightedInterfaceIds.add(entry.id);
    }
  }

  const branchChildren = new Map<string, string[]>();
  branchChildren.set('local', interfaces.map((entry) => `interface:${entry.id}`));
  for (const interfaceEntry of interfaces) {
    const interfaceRoutes = visiblePaths.filter((route) => route.interface.id === interfaceEntry.id);
    const nextHopIds = Array.from(new Set(interfaceRoutes.flatMap((route) => {
      const nextHop = route.path.hops > 1 && route.path.nextHop !== route.path.destinationHash
        ? route.path.nextHop
        : undefined;
      return nextHop ? [`next-hop:${interfaceEntry.id}:${nextHop}`] : [];
    }))).sort((left, right) => left.localeCompare(right));
    const directDestinationIds = interfaceRoutes
      .filter((route) => !(route.path.hops > 1
        && route.path.nextHop
        && route.path.nextHop !== route.path.destinationHash))
      .map((route) => `destination:${route.path.destinationHash}`)
      .sort((left, right) => left.localeCompare(right));
    branchChildren.set(
      `interface:${interfaceEntry.id}`,
      [...nextHopIds, ...directDestinationIds],
    );
    for (const nextHopId of nextHopIds) {
      const nextHopHash = nextHopId.slice(`next-hop:${interfaceEntry.id}:`.length);
      branchChildren.set(nextHopId, interfaceRoutes
        .filter((route) => route.path.nextHop === nextHopHash)
        .map((route) => `destination:${route.path.destinationHash}`)
        .sort((left, right) => left.localeCompare(right)));
    }
  }
  const { radii: orbitRadii, edgeScales: orbitEdgeScales } = cachedBranchOrbitLayout(branchChildren);

  let nodes: NetworkVisualizerNode[] = [{
    id: 'local',
    kind: 'local',
    label: input.identity?.displayName ?? '',
    identityHash: input.identity?.identityHashHex,
    x: center.x,
    y: center.y,
    matched: Boolean(query && (localMatches || matchedPaths.length > 0)),
  }];
  const edges: NetworkVisualizerEdge[] = [];
  const seedPositions = new Map<string, { x: number; y: number }>([['local', center]]);
  const branchAngles = new Map<string, number>();
  for (const [index, entry] of interfaces.entries()) {
    const angle = interfaces.length > 0 ? index / interfaces.length * fullCircle : 0;
    const nodeId = `interface:${entry.id}`;
    const position = pointOnCircle(
      angle,
      branchEdgeLength('local', nodeId, orbitRadii, orbitEdgeScales),
    );
    seedPositions.set(nodeId, position);
    branchAngles.set(nodeId, angle);
    nodes.push({
      id: nodeId,
      kind: 'interface',
      label: entry.name,
      interfaceId: entry.configured ? entry.id : undefined,
      interfaceName: entry.name,
      interfaceType: entry.type,
      interfaceState: entry.state,
      x: position.x,
      y: position.y,
      matched: Boolean(query && highlightedInterfaceIds.has(entry.id)),
    });
    edges.push({
      id: `local~interface:${entry.id}`,
      from: 'local',
      to: nodeId,
      kind: 'interface',
      matched: Boolean(query && highlightedInterfaceIds.has(entry.id)),
    });
  }

  const nextHopRoutes = new Map<string, VisualizerPath[]>();
  for (const route of visiblePaths) {
    const nextHop = route.path.hops > 1 && route.path.nextHop !== route.path.destinationHash
      ? route.path.nextHop
      : undefined;
    if (!nextHop) continue;
    const id = `${route.interface.id}:${nextHop}`;
    const current = nextHopRoutes.get(id) ?? [];
    current.push(route);
    nextHopRoutes.set(id, current);
  }

  const nextHopsByInterface = new Map<string, Array<[string, VisualizerPath[]]>>();
  for (const entry of nextHopRoutes) {
    const interfaceId = entry[1][0].interface.id;
    const current = nextHopsByInterface.get(interfaceId) ?? [];
    current.push(entry);
    nextHopsByInterface.set(interfaceId, current);
  }

  const routesByParent = new Map<string, VisualizerPath[]>();
  for (const route of visiblePaths) {
    const nextHop = route.path.hops > 1 && route.path.nextHop !== route.path.destinationHash
      ? route.path.nextHop
      : undefined;
    const from = nextHop
      ? `next-hop:${route.interface.id}:${nextHop}`
      : `interface:${route.interface.id}`;
    const current = routesByParent.get(from) ?? [];
    current.push(route);
    routesByParent.set(from, current);
  }

  // Interfaces can own both next-hop nodes and direct destinations. Allocate
  // their angular slots together so the local-to-interface edge participates
  // in the same degree-based spacing as every other branch.
  const interfaceChildAngles = new Map<string, number>();
  for (const interfaceEntry of interfaces) {
    const interfaceNodeId = `interface:${interfaceEntry.id}`;
    const outwardAngle = branchAngles.get(interfaceNodeId);
    if (outwardAngle === undefined) continue;
    const childIds = branchChildren.get(interfaceNodeId) ?? [];
    for (const [index, childId] of childIds.entries()) {
      interfaceChildAngles.set(
        childId,
        childBranchAngle(outwardAngle, index, childIds.length),
      );
    }
  }

  for (const interfaceEntry of interfaces) {
    const interfaceId = interfaceEntry.id;
    const nextHops = (nextHopsByInterface.get(interfaceId) ?? [])
      .sort(([left], [right]) => left.localeCompare(right));
    const interfaceNodeId = `interface:${interfaceId}`;
    const interfacePosition = seedPositions.get(interfaceNodeId);
    const interfaceAngle = branchAngles.get(interfaceNodeId);
    if (!interfacePosition || interfaceAngle === undefined) continue;
    for (const [index, [id, routes]] of nextHops.entries()) {
      const first = routes[0];
      const nodeId = `next-hop:${id}`;
      const angle = interfaceChildAngles.get(nodeId)
        ?? childBranchAngle(interfaceAngle, index, nextHops.length);
      const hopPosition = pointFrom(
        interfacePosition,
        angle,
        branchEdgeLength(interfaceNodeId, nodeId, orbitRadii, orbitEdgeScales),
      );
      seedPositions.set(nodeId, hopPosition);
      branchAngles.set(nodeId, angle);
      const nextHop = first.path.nextHop!;
      nodes.push({
        id: nodeId,
        kind: 'nextHop',
        label: abbreviatedHash(nextHop),
        nextHopHash: nextHop,
        interfaceId: first.path.interfaceId,
        interfaceName: first.interface.name,
        x: hopPosition.x,
        y: hopPosition.y,
        matched: Boolean(query && routes.some((route) => matchedPathKeys.has(pathKey(route)))),
      });
      edges.push({
        id: `${interfaceNodeId}~next-hop:${id}`,
        from: interfaceNodeId,
        to: nodeId,
        kind: 'route',
        matched: Boolean(query && routes.some((route) => matchedPathKeys.has(pathKey(route)))),
      });
    }
  }

  const orderedRouteGroups = Array.from(routesByParent.entries())
    .sort(([left], [right]) => left.localeCompare(right));
  for (const [from, unorderedRoutes] of orderedRouteGroups) {
    const routes = unorderedRoutes.sort((left, right) => (
      left.path.destinationHash.localeCompare(right.path.destinationHash)
    ));
    const parentPosition = seedPositions.get(from) ?? center;
    const parentAngle = branchAngles.get(from) ?? 0;
    for (const [index, route] of routes.entries()) {
      const destinationId = `destination:${route.path.destinationHash}`;
      const angle = interfaceChildAngles.get(destinationId)
        ?? childBranchAngle(parentAngle, index, routes.length);
      const destinationPosition = pointFrom(
        parentPosition,
        angle,
        branchEdgeLength(from, destinationId, orbitRadii, orbitEdgeScales),
      );
      seedPositions.set(destinationId, destinationPosition);
      branchAngles.set(destinationId, angle);
      nodes.push({
        id: destinationId,
        kind: 'destination',
        label: route.label,
        destinationHash: route.path.destinationHash,
        interfaceId: route.path.interfaceId,
        interfaceName: route.interface.name,
        hops: route.path.hops,
        fullDestinationName: route.fullDestinationName,
        x: destinationPosition.x,
        y: destinationPosition.y,
        matched: Boolean(query && matchedPathKeys.has(pathKey(route))),
      });
      edges.push({
        id: `${from}~${destinationId}`,
        from,
        to: destinationId,
        kind: route.path.hops <= 1 ? 'direct' : 'route',
        hops: route.path.hops,
        matched: Boolean(query && matchedPathKeys.has(pathKey(route))),
      });
    }
  }

  nodes = cachedSettledLayout(nodes, edges);

  return {
    nodes,
    edges,
    pathCount: visiblePaths.length,
    hiddenPathCount: Math.max(0, sortedPaths.length - visiblePaths.length),
    matchedPathCount: matchedPaths.length,
    bounds: graphBounds(nodes),
  };
}
