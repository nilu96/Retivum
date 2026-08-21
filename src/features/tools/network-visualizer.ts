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

export type NetworkVisualizerNodeKind = 'local' | 'interface' | 'identity' | 'nextHop' | 'destination';
export type NetworkVisualizerEdgeKind = 'interface' | 'direct' | 'route';

export interface NetworkVisualizerNode {
  id: string;
  kind: NetworkVisualizerNodeKind;
  label: string;
  x: number;
  y: number;
  destinationHash?: string;
  identityHash?: string;
  publicKey?: string;
  nextHopHash?: string;
  interfaceId?: string;
  interfaceName?: string;
  interfaceType?: InterfaceConfig['type'];
  interfaceState?: InterfaceRuntimeState;
  hops?: number;
  fullDestinationName?: KnownFullDestinationName;
  destinationCount?: number;
  expanded?: boolean;
  matched?: boolean;
}

export interface NetworkVisualizerEdge {
  id: string;
  from: string;
  to: string;
  kind: NetworkVisualizerEdgeKind;
  hops?: number;
  showHopLabel?: boolean;
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
  groupByIdentity?: boolean;
  expandedIdentityPublicKeys?: ReadonlySet<string>;
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
  publicKey?: string;
  identityHash?: string;
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
  identity: 110,
  nextHop: 110,
};

const branchNodeCircleRadius: Record<Exclude<NetworkVisualizerNodeKind, 'destination'>, number> = {
  local: 38,
  interface: 31,
  identity: 27,
  nextHop: 27,
};

interface BranchOrbitLayout {
  radii: Map<string, number>;
  edgeScales: Map<string, number>;
  edgeLengths: Map<string, number>;
}

interface CrowdedLeafLayout {
  radius: number;
  distances: number[];
}

interface CrowdedCirclePair {
  left: number;
  right: number;
  cosine: number;
  oneMinusCosine: number;
  clearanceSquared: number;
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
  destination: KnownDestinationRecord | undefined,
): string {
  return presentation?.localContactName
    || destination?.displayName
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
  if (nodeId.startsWith('identity:')) return 'identity';
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
 * Packs a high-degree branch into several concentric rings. Child circles can
 * be simple leaf bubbles or complete recursively sized subtrees. For each ring
 * count, coprime layer orders distribute neighbouring spokes across the
 * available radii. Radial spacing is sampled from zero through the largest
 * required bubble clearance. The quadratic pair-distance constraint gives the
 * exact smallest base radius for each candidate, so invalid/intersecting child
 * circles are never eligible.
 */
function crowdedCircleLayout(
  childCircleRadii: readonly number[],
  slotCount: number,
  step: number,
  minimumRadius: number,
  parentCircleRadius: number,
): CrowdedLeafLayout {
  const childCount = childCircleRadii.length;
  const maximumBubbleClearance = childCircleRadii.length > 1
    ? Math.max(...childCircleRadii.flatMap((radius, index) => (
      childCircleRadii.slice(index + 1).map((otherRadius) => (
        radius + otherRadius + branchCircleGap
      ))
    )))
    : childCircleRadii[0] * 2 + branchCircleGap;
  const maximumLayers = Math.min(
    maximumCrowdedLeafLayers,
    Math.max(2, Math.ceil(Math.sqrt(childCount))),
  );
  let selectedRadius = Number.POSITIVE_INFINITY;
  let selectedDistances: number[] = [];
  const pairs: CrowdedCirclePair[] = [];
  for (let left = 0; left < childCount; left += 1) {
    for (let right = left + 1; right < childCount; right += 1) {
      const slotDistance = Math.min(right - left, slotCount - (right - left));
      const cosine = Math.cos(slotDistance * step);
      const clearance = childCircleRadii[left]
        + childCircleRadii[right]
        + branchCircleGap;
      pairs.push({
        left,
        right,
        cosine,
        oneMinusCosine: 1 - cosine,
        clearanceSquared: clearance ** 2,
      });
    }
  }

  for (let layerCount = 1; layerCount <= maximumLayers; layerCount += 1) {
    const strides = layerCount === 1
      ? [0]
      : Array.from({ length: layerCount - 1 }, (_, index) => index + 1)
        .filter((stride) => greatestCommonDivisor(stride, layerCount) === 1);
    for (const stride of strides) {
      for (let sample = 0; sample <= crowdedLayerSpacingSamples; sample += 1) {
        const layerSpacing = maximumBubbleClearance * sample / crowdedLayerSpacingSamples;
        const offsets = Array.from({ length: childCount }, (_, index) => (
          layerCount === 1 ? 0 : (index * stride % layerCount) * layerSpacing
        ));
        let baseRadius = minimumRadius;
        for (const [index, childRadius] of childCircleRadii.entries()) {
          baseRadius = Math.max(
            baseRadius,
            parentCircleRadius + childRadius + branchCircleGap - offsets[index],
          );
        }
        for (const pair of pairs) {
          const leftOffset = offsets[pair.left];
          const rightOffset = offsets[pair.right];
          const constant = leftOffset ** 2
            + rightOffset ** 2
            - 2 * leftOffset * rightOffset * pair.cosine
            - pair.clearanceSquared;
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

function crowdedLeafLayout(
  childCount: number,
  slotCount: number,
  step: number,
  minimumRadius: number,
): CrowdedLeafLayout {
  return crowdedCircleLayout(
    Array.from({ length: childCount }, () => leafCircleRadius),
    slotCount,
    step,
    minimumRadius,
    branchNodeCircleRadius.identity,
  );
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
  const edgeLengths = new Map<string, number>();
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
    if (children.length >= crowdedLeafThreshold) {
      const crowdedLayout = crowdedCircleLayout(
        childCircleRadii,
        slotCount,
        step,
        minimumRadius,
        branchNodeCircleRadius[kind],
      );
      radius = crowdedLayout.radius;
      selectedScales = crowdedLayout.distances.map((distance) => distance / radius);
      for (const [index, childId] of children.entries()) {
        edgeLengths.set(`${nodeId}\u0000${childId}`, crowdedLayout.distances[index]);
      }
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
  return { radii, edgeScales, edgeLengths };
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
  edgeLengths: ReadonlyMap<string, number>,
): number {
  const explicitLength = edgeLengths.get(`${parentId}\u0000${childId}`);
  if (explicitLength !== undefined) return explicitLength;
  const parentRadius = orbitRadii.get(parentId) ?? 0;
  const childRadius = orbitRadii.get(childId) ?? 0;
  if (childRadius > 0) return parentRadius + childRadius + branchCircleGap;
  return parentRadius * (edgeScales.get(`${parentId}\u0000${childId}`) ?? 1);
}

const topologyKindOrder: Record<NetworkVisualizerNodeKind, number> = {
  local: 0,
  interface: 1,
  nextHop: 2,
  identity: 3,
  destination: 4,
};

/**
 * Rebuilds a rooted branch tree from a projected graph and applies the same
 * recursive orbit sizing used by the base network layout. Grouping can turn a
 * former leaf into an identity branch with its own destination orbit, so its
 * complete child-circle radius must be known before its parent is positioned.
 * Additional incoming graph edges remain visible, but the shortest rooted
 * traversal chooses one layout parent for every node and therefore cannot
 * introduce cycles into the recursive sizing pass.
 */
function recursivelyArrangeTopology(
  nodes: readonly NetworkVisualizerNode[],
  edges: readonly NetworkVisualizerEdge[],
): NetworkVisualizerNode[] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  if (!nodesById.has('local')) return nodes.map((node) => ({ ...node }));

  const compareNodeIds = (leftId: string, rightId: string): number => {
    const left = nodesById.get(leftId);
    const right = nodesById.get(rightId);
    if (!left || !right) return leftId.localeCompare(rightId);
    return topologyKindOrder[left.kind] - topologyKindOrder[right.kind]
      || left.label.localeCompare(right.label)
      || left.id.localeCompare(right.id);
  };
  const outgoing = new Map<string, Set<string>>();
  for (const edge of edges) {
    if (edge.from === edge.to || !nodesById.has(edge.from) || !nodesById.has(edge.to)) continue;
    const children = outgoing.get(edge.from) ?? new Set<string>();
    children.add(edge.to);
    outgoing.set(edge.from, children);
  }

  const childrenByParent = new Map<string, string[]>();
  const reached = new Set<string>(['local']);
  const queue = ['local'];
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const parentId = queue[cursor];
    const children = Array.from(outgoing.get(parentId) ?? []).sort(compareNodeIds);
    for (const childId of children) {
      if (reached.has(childId)) continue;
      reached.add(childId);
      queue.push(childId);
      const branchChildren = childrenByParent.get(parentId) ?? [];
      branchChildren.push(childId);
      childrenByParent.set(parentId, branchChildren);
    }
  }

  // A malformed or partially projected snapshot should remain renderable. Put
  // any orphan beside the root instead of allowing every orphan to overlap at
  // the graph center.
  const orphans = Array.from(nodesById.keys())
    .filter((nodeId) => !reached.has(nodeId))
    .sort(compareNodeIds);
  if (orphans.length) {
    const rootChildren = childrenByParent.get('local') ?? [];
    rootChildren.push(...orphans);
    childrenByParent.set('local', rootChildren);
  }

  const { radii, edgeScales, edgeLengths } = cachedBranchOrbitLayout(childrenByParent);
  const positions = new Map<string, { x: number; y: number }>([['local', center]]);
  const outwardAngles = new Map<string, number>();
  const placeChildren = (parentId: string): void => {
    const parentPosition = positions.get(parentId);
    if (!parentPosition) return;
    const children = childrenByParent.get(parentId) ?? [];
    const parentAngle = outwardAngles.get(parentId) ?? 0;
    for (const [index, childId] of children.entries()) {
      const angle = parentId === 'local'
        ? index / Math.max(1, children.length) * fullCircle
        : childBranchAngle(parentAngle, index, children.length);
      positions.set(childId, pointFrom(
        parentPosition,
        angle,
        branchEdgeLength(parentId, childId, radii, edgeScales, edgeLengths),
      ));
      outwardAngles.set(childId, angle);
      placeChildren(childId);
    }
  };
  placeChildren('local');

  return nodes.map((node) => ({
    ...node,
    ...(positions.get(node.id) ?? {}),
  }));
}

interface VisualizerIdentityGroup {
  publicKey: string;
  identityHash?: string;
  routes: VisualizerPath[];
}

interface VisualizerIdentityOccurrence {
  id: string;
  ingressId: string;
  destinationIds: Set<string>;
  routes: VisualizerPath[];
  transportNodes: NetworkVisualizerNode[];
}

function routeIngressNodeId(route: VisualizerPath): string {
  const nextHop = route.path.hops > 1 && route.path.nextHop !== route.path.destinationHash
    ? route.path.nextHop
    : undefined;
  return nextHop
    ? `next-hop:${route.interface.id}:${nextHop}`
    : `interface:${route.interface.id}`;
}

function identityOccurrenceId(publicKey: string, ingressId: string): string {
  return `identity:${publicKey}:via:${encodeURIComponent(ingressId)}`;
}

function averageNodePosition(
  nodeIds: readonly string[],
  nodesById: ReadonlyMap<string, NetworkVisualizerNode>,
): { x: number; y: number } | undefined {
  const positions = nodeIds.flatMap((nodeId) => {
    const node = nodesById.get(nodeId);
    return node ? [{ x: node.x, y: node.y }] : [];
  });
  if (!positions.length) return undefined;
  return {
    x: positions.reduce((sum, position) => sum + position.x, 0) / positions.length,
    y: positions.reduce((sum, position) => sum + position.y, 0) / positions.length,
  };
}

function stableIdentityAngle(publicKey: string): number {
  let seed = 0;
  for (let index = 0; index < publicKey.length; index += 1) {
    seed = (seed * 31 + publicKey.charCodeAt(index)) >>> 0;
  }
  return seed / 0xffff_ffff * fullCircle;
}

function identityChildLayout(childCount: number): CrowdedLeafLayout {
  if (childCount === 0) return { radius: 0, distances: [] };
  const slotCount = childCount + 1;
  const step = fullCircle / slotCount;
  const minimumRadius = minimumBranchRadius.identity;
  if (childCount >= crowdedLeafThreshold) {
    return crowdedLeafLayout(childCount, slotCount, step, minimumRadius);
  }
  const bubbleClearance = leafCircleRadius * 2 + branchCircleGap;
  const adjacentClearanceRadius = bubbleClearance / (2 * Math.sin(step / 2));
  const parentClearanceRadius = branchNodeCircleRadius.identity
    + leafCircleRadius
    + branchCircleGap;
  const radius = Math.max(minimumRadius, adjacentClearanceRadius, parentClearanceRadius);
  return { radius, distances: Array.from({ length: childCount }, () => radius) };
}

function mergeGroupedEdges(edges: readonly NetworkVisualizerEdge[]): NetworkVisualizerEdge[] {
  const merged = new Map<string, NetworkVisualizerEdge>();
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    const key = `${edge.from}\u0000${edge.to}`;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...edge, id: `${edge.from}~${edge.to}` });
      continue;
    }
    const currentHops = current.hops ?? Number.POSITIVE_INFINITY;
    const edgeHops = edge.hops ?? Number.POSITIVE_INFINITY;
    if (edgeHops < currentHops) {
      current.hops = edge.hops;
      current.kind = edge.kind;
    }
    current.matched = Boolean(current.matched || edge.matched);
  }
  return Array.from(merged.values());
}

/**
 * Projects one logical identity into each distinct ingress branch used by its
 * visible destinations. Expansion remains public-key scoped, while every
 * occurrence owns only the child destinations reached through its interface
 * and immediate transport path. This preserves a recursive tree layout without
 * losing the fact that one identity can be reachable through several paths.
 */
function groupNetworkVisualizerIdentities(
  sourceNodes: readonly NetworkVisualizerNode[],
  sourceEdges: readonly NetworkVisualizerEdge[],
  routes: readonly VisualizerPath[],
  inventory: readonly KnownDestinationEntry[],
  query: string,
  highlightActive: boolean,
  expandedIdentityPublicKeys: ReadonlySet<string>,
): { nodes: NetworkVisualizerNode[]; edges: NetworkVisualizerEdge[] } {
  const groups = new Map<string, VisualizerIdentityGroup>();
  for (const entry of inventory) {
    if (!entry.publicKey) continue;
    const current = groups.get(entry.publicKey);
    if (current) current.identityHash ??= entry.identityHash;
    else groups.set(entry.publicKey, {
      publicKey: entry.publicKey,
      identityHash: entry.identityHash,
      routes: [],
    });
  }
  for (const route of routes) {
    if (!route.publicKey) continue;
    const current = groups.get(route.publicKey);
    if (current) {
      current.routes.push(route);
      current.identityHash ??= route.identityHash;
    } else {
      groups.set(route.publicKey, {
        publicKey: route.publicKey,
        identityHash: route.identityHash,
        routes: [route],
      });
    }
  }

  let nodes = sourceNodes.map((node) => ({ ...node }));
  let edges = sourceEdges.map((edge) => ({ ...edge }));
  const matchedDestinationIds = new Set(sourceNodes
    .filter((node) => node.kind === 'destination' && node.matched)
    .map((node) => node.id));
  for (const group of Array.from(groups.values()).sort((left, right) => (
    left.publicKey.localeCompare(right.publicKey)
  ))) {
    const destinationIds = Array.from(new Set(group.routes.map((route) => (
      `destination:${route.path.destinationHash}`
    )))).sort((left, right) => left.localeCompare(right));
    const shortestRouteByDestinationId = new Map<string, VisualizerPath>();
    for (const route of group.routes) {
      const destinationId = `destination:${route.path.destinationHash}`;
      const current = shortestRouteByDestinationId.get(destinationId);
      if (!current || route.path.hops < current.path.hops) {
        shortestRouteByDestinationId.set(destinationId, route);
      }
    }
    const transportNodes = group.identityHash
      ? nodes.filter((node) => node.nextHopHash === group.identityHash)
      : [];
    if (destinationIds.length < 2 && transportNodes.length === 0) continue;
    const transportIdentityHash = transportNodes.length > 0
      ? group.identityHash
      : undefined;

    const destinationGroup = destinationIds.length >= 2;
    const expanded = !destinationGroup || expandedIdentityPublicKeys.has(group.publicKey);
    const transportNodeIds = new Set(transportNodes.map((node) => node.id));
    const nodesById = new Map(nodes.map((node) => [node.id, node]));
    const destinationNodesById = new Map(destinationIds.flatMap((destinationId) => {
      const destination = nodesById.get(destinationId);
      return destination ? [[destinationId, destination] as const] : [];
    }));
    const occurrencesByIngressId = new Map<string, VisualizerIdentityOccurrence>();
    const ensureOccurrence = (ingressId: string): VisualizerIdentityOccurrence => {
      const current = occurrencesByIngressId.get(ingressId);
      if (current) return current;
      const occurrence: VisualizerIdentityOccurrence = {
        id: identityOccurrenceId(group.publicKey, ingressId),
        ingressId,
        destinationIds: new Set(),
        routes: [],
        transportNodes: [],
      };
      occurrencesByIngressId.set(ingressId, occurrence);
      return occurrence;
    };
    for (const transportNode of transportNodes) {
      ensureOccurrence(transportNode.id).transportNodes.push(transportNode);
    }
    for (const [destinationId, route] of shortestRouteByDestinationId) {
      const routeIngressId = routeIngressNodeId(route);
      const colocatedTransportNode = transportNodes.find((transportNode) => (
        transportNode.interfaceId === route.interface.id
        && (routeIngressId === `interface:${route.interface.id}`
          || routeIngressId === transportNode.id)
      ));
      const occurrence = ensureOccurrence(colocatedTransportNode?.id ?? routeIngressId);
      occurrence.destinationIds.add(destinationId);
      occurrence.routes.push(route);
    }
    const occurrences = Array.from(occurrencesByIngressId.values()).sort((left, right) => (
      left.ingressId.localeCompare(right.ingressId)
    ));
    const occurrenceIdByTransportNodeId = new Map(occurrences.flatMap((occurrence) => (
      occurrence.transportNodes.map((transportNode) => [transportNode.id, occurrence.id] as const)
    )));
    const occurrenceIdByDestinationId = new Map(occurrences.flatMap((occurrence) => (
      Array.from(occurrence.destinationIds, (destinationId) => [destinationId, occurrence.id] as const)
    )));
    const remapTransportNodeId = (nodeId: string): string => (
      occurrenceIdByTransportNodeId.get(nodeId) ?? nodeId
    );
    const destinationIdSet = new Set(destinationIds);
    const mappedEdges = edges.map((edge) => ({
      ...edge,
      from: remapTransportNodeId(edge.from),
      to: remapTransportNodeId(edge.to),
    }));
    const incomingDestinationEdges = mappedEdges.filter((edge) => destinationIdSet.has(edge.to));
    edges = mappedEdges.filter((edge) => !destinationIdSet.has(edge.to));
    for (const incoming of incomingDestinationEdges) {
      const occurrenceId = occurrenceIdByDestinationId.get(incoming.to);
      if (!occurrenceId || incoming.from === occurrenceId) continue;
      edges.push({
        ...incoming,
        id: `${incoming.from}~${occurrenceId}`,
        to: occurrenceId,
      });
    }

    const identityLabel = abbreviatedHash(group.identityHash ?? group.publicKey);
    const identityQueryMatches = query.length > 0 && (
      group.publicKey.toLowerCase().includes(query)
      || group.identityHash?.toLowerCase().includes(query)
      || identityLabel.toLowerCase().includes(query)
    );
    nodes = nodes.filter((node) => (
      !transportNodeIds.has(node.id)
      && !destinationIdSet.has(node.id)
    ));
    for (const occurrence of occurrences) {
      const incomingSourceIds = Array.from(new Set(edges
        .filter((edge) => edge.to === occurrence.id)
        .map((edge) => edge.from)
        .filter((nodeId) => nodeId !== occurrence.id)));
      const occurrenceDestinationIds = Array.from(occurrence.destinationIds).sort((left, right) => (
        left.localeCompare(right)
      ));
      const sourcePosition = averageNodePosition(incomingSourceIds, nodesById);
      const destinationPosition = averageNodePosition(occurrenceDestinationIds, nodesById);
      const transportPosition = averageNodePosition(
        occurrence.transportNodes.map((node) => node.id),
        nodesById,
      );
      const children = identityChildLayout(occurrenceDestinationIds.length);
      const fallbackAngle = stableIdentityAngle(`${group.publicKey}:${occurrence.ingressId}`);
      let outwardAngle = fallbackAngle;
      if (sourcePosition && destinationPosition) {
        const differenceX = destinationPosition.x - sourcePosition.x;
        const differenceY = destinationPosition.y - sourcePosition.y;
        if (Math.hypot(differenceX, differenceY) > .001) {
          outwardAngle = Math.atan2(differenceY, differenceX);
        }
      } else if (transportPosition && sourcePosition) {
        outwardAngle = Math.atan2(
          transportPosition.y - sourcePosition.y,
          transportPosition.x - sourcePosition.x,
        );
      }
      const identityPosition = transportPosition
        ?? (sourcePosition
          ? pointFrom(sourcePosition, outwardAngle, children.radius + 90)
          : destinationPosition ?? pointOnCircle(outwardAngle, children.radius + 145));
      const identityMatches = Boolean(highlightActive && (
        identityQueryMatches
        || (destinationGroup && expanded && query.length === 0)
        || occurrence.routes.some((route) => matchedDestinationIds.has(
          `destination:${route.path.destinationHash}`,
        ))
        || occurrence.transportNodes.some((node) => node.matched)
      ));
      nodes.push({
        id: occurrence.id,
        kind: 'identity',
        label: identityLabel,
        publicKey: group.publicKey,
        identityHash: group.identityHash,
        ...(transportIdentityHash
          ? { nextHopHash: transportIdentityHash }
          : {}),
        ...(destinationGroup ? {
          destinationCount: destinationIds.length,
          expanded,
        } : {}),
        x: identityPosition.x,
        y: identityPosition.y,
        matched: identityMatches,
      });
      if (!expanded) continue;
      for (const [index, destinationId] of occurrenceDestinationIds.entries()) {
        const destination = destinationNodesById.get(destinationId);
        if (!destination) continue;
        const shortestRoute = shortestRouteByDestinationId.get(destinationId);
        const angle = childBranchAngle(outwardAngle, index, occurrenceDestinationIds.length);
        const position = pointFrom(identityPosition, angle, children.distances[index]);
        destination.x = position.x;
        destination.y = position.y;
        nodes.push(destination);
        edges.push({
          id: `${occurrence.id}~${destinationId}`,
          from: occurrence.id,
          to: destinationId,
          kind: 'direct',
          hops: shortestRoute?.path.hops,
          showHopLabel: false,
          matched: destination.matched,
        });
      }
    }
  }

  return { nodes, edges: mergeGroupedEdges(edges) };
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
    path.publicKey,
    path.identityHash,
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
  const inventoryByHash = new Map(inventory.map((entry) => [entry.destinationHash, entry]));
  const destinationsByHash = new Map(input.destinations.map((entry) => [
    entry.destinationHash,
    entry,
  ]));
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
    const inventoryEntry = inventoryByHash.get(path.destinationHash);
    return [{
      path,
      interface: interfaceEntry,
      label: destinationLabel(
        path.destinationHash,
        presentation,
        destinationsByHash.get(path.destinationHash),
      ),
      fullDestinationName: presentation?.fullDestinationName,
      publicKey: inventoryEntry?.publicKey,
      identityHash: inventoryEntry?.identityHash,
    }];
  });

  const query = input.search?.trim().toLowerCase() ?? '';
  const pathLimit = Math.max(1, input.pathLimit ?? networkVisualizerPathLimit);
  const knownDestinationHashesByPublicKey = new Map<string, Set<string>>();
  for (const entry of preparedPaths) {
    if (!entry.publicKey) continue;
    const hashes = knownDestinationHashesByPublicKey.get(entry.publicKey) ?? new Set<string>();
    hashes.add(entry.path.destinationHash);
    knownDestinationHashesByPublicKey.set(entry.publicKey, hashes);
  }
  const requestedExpandedIdentityPublicKeys = new Set(input.groupByIdentity
    ? Array.from(input.expandedIdentityPublicKeys ?? []).filter((publicKey) => (
      (knownDestinationHashesByPublicKey.get(publicKey)?.size ?? 0) >= 2
    ))
    : []);
  const localMatches = query.length > 0 && [
    input.identity?.displayName,
    input.identity?.identityHashHex,
  ].filter(Boolean).some((value) => value!.toLowerCase().includes(query));
  const queryMatchesPath = (entry: VisualizerPath): boolean => (
    query.length > 0 && (localMatches || searchablePath(entry).includes(query))
  );
  const requestedIdentityMatchesPath = (entry: VisualizerPath): boolean => (
    query.length === 0
    && Boolean(entry.publicKey && requestedExpandedIdentityPublicKeys.has(entry.publicKey))
  );
  const sortMatchesPath = (entry: VisualizerPath): boolean => (
    queryMatchesPath(entry) || requestedIdentityMatchesPath(entry)
  );
  const sortedPaths = preparedPaths.sort((left, right) => (
    ((query.length > 0 || requestedExpandedIdentityPublicKeys.size > 0)
      ? Number(sortMatchesPath(right)) - Number(sortMatchesPath(left))
      : 0)
    || left.interface.name.localeCompare(right.interface.name)
    || (left.path.nextHop ?? '').localeCompare(right.path.nextHop ?? '')
    || left.path.hops - right.path.hops
    || left.label.localeCompare(right.label)
    || left.path.destinationHash.localeCompare(right.path.destinationHash)
  ));
  const visiblePaths = sortedPaths.slice(0, pathLimit);
  const visibleDestinationHashesByPublicKey = new Map<string, Set<string>>();
  for (const entry of visiblePaths) {
    if (!entry.publicKey) continue;
    const hashes = visibleDestinationHashesByPublicKey.get(entry.publicKey) ?? new Set<string>();
    hashes.add(entry.path.destinationHash);
    visibleDestinationHashesByPublicKey.set(entry.publicKey, hashes);
  }
  const expandedIdentityPublicKeys = new Set(Array.from(requestedExpandedIdentityPublicKeys)
    .filter((publicKey) => (visibleDestinationHashesByPublicKey.get(publicKey)?.size ?? 0) >= 2));
  const identityHighlightActive = query.length === 0 && expandedIdentityPublicKeys.size > 0;
  const highlightActive = query.length > 0 || identityHighlightActive;
  const identityMatchesPath = (entry: VisualizerPath): boolean => (
    identityHighlightActive
    && Boolean(entry.publicKey && expandedIdentityPublicKeys.has(entry.publicKey))
  );
  const pathMatches = (entry: VisualizerPath): boolean => (
    queryMatchesPath(entry) || identityMatchesPath(entry)
  );
  const matchedPaths = visiblePaths.filter(pathMatches);
  const queryMatchedPaths = visiblePaths.filter(queryMatchesPath);
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
  const {
    radii: orbitRadii,
    edgeScales: orbitEdgeScales,
    edgeLengths: orbitEdgeLengths,
  } = cachedBranchOrbitLayout(branchChildren);

  let nodes: NetworkVisualizerNode[] = [{
    id: 'local',
    kind: 'local',
    label: input.identity?.displayName.trim()
      || (input.identity?.identityHashHex
        ? abbreviatedHash(input.identity.identityHashHex)
        : ''),
    identityHash: input.identity?.identityHashHex,
    x: center.x,
    y: center.y,
    matched: Boolean(highlightActive && (localMatches || matchedPaths.length > 0)),
  }];
  let edges: NetworkVisualizerEdge[] = [];
  const seedPositions = new Map<string, { x: number; y: number }>([['local', center]]);
  const branchAngles = new Map<string, number>();
  for (const [index, entry] of interfaces.entries()) {
    const angle = interfaces.length > 0 ? index / interfaces.length * fullCircle : 0;
    const nodeId = `interface:${entry.id}`;
    const position = pointOnCircle(
      angle,
      branchEdgeLength('local', nodeId, orbitRadii, orbitEdgeScales, orbitEdgeLengths),
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
      matched: Boolean(highlightActive && highlightedInterfaceIds.has(entry.id)),
    });
    edges.push({
      id: `local~interface:${entry.id}`,
      from: 'local',
      to: nodeId,
      kind: 'interface',
      matched: Boolean(highlightActive && highlightedInterfaceIds.has(entry.id)),
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
        branchEdgeLength(
          interfaceNodeId,
          nodeId,
          orbitRadii,
          orbitEdgeScales,
          orbitEdgeLengths,
        ),
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
        matched: Boolean(highlightActive && routes.some((route) => matchedPathKeys.has(pathKey(route)))),
      });
      edges.push({
        id: `${interfaceNodeId}~next-hop:${id}`,
        from: interfaceNodeId,
        to: nodeId,
        kind: 'route',
        matched: Boolean(highlightActive && routes.some((route) => matchedPathKeys.has(pathKey(route)))),
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
        branchEdgeLength(from, destinationId, orbitRadii, orbitEdgeScales, orbitEdgeLengths),
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
        matched: Boolean(highlightActive && matchedPathKeys.has(pathKey(route))),
      });
      edges.push({
        id: `${from}~${destinationId}`,
        from,
        to: destinationId,
        // Hop count describes route length, not identity ownership. A two-hop
        // path still traverses an immediate transport node and must remain a
        // routed (dashed) edge. Only destinations reached directly from an
        // interface are solid here; proven identity membership is projected
        // separately by groupNetworkVisualizerIdentities().
        kind: from.startsWith('interface:') ? 'direct' : 'route',
        hops: route.path.hops,
        matched: Boolean(highlightActive && matchedPathKeys.has(pathKey(route))),
      });
    }
  }

  if (input.groupByIdentity) {
    const grouped = groupNetworkVisualizerIdentities(
      nodes,
      edges,
      visiblePaths,
      inventory,
      query,
      highlightActive,
      expandedIdentityPublicKeys,
    );
    nodes = recursivelyArrangeTopology(grouped.nodes, grouped.edges);
    edges = grouped.edges;
  } else {
    nodes = cachedSettledLayout(nodes, edges);
  }

  return {
    nodes,
    edges,
    pathCount: visiblePaths.length,
    hiddenPathCount: Math.max(0, sortedPaths.length - visiblePaths.length),
    matchedPathCount: queryMatchedPaths.length,
    bounds: graphBounds(nodes),
  };
}
