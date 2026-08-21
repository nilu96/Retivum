import { Position, type Edge, type Node } from '@xyflow/svelte';
import type { ContextMenuOpenMethod } from '../../lib/actions/contextMenuTrigger';
import type { IconName } from '../../lib/components/Icon.svelte';
import type {
  NetworkVisualizerEdge,
  NetworkVisualizerGraph,
  NetworkVisualizerNode,
  NetworkVisualizerNodeKind,
} from './network-visualizer';

export interface NetworkFlowLabelPlacement {
  x: number;
  y: number;
  anchor: 'start' | 'middle' | 'end';
}

export interface NetworkFlowNodeData extends Record<string, unknown> {
  actionable: boolean;
  ariaLabel: string;
  contextActionable: boolean;
  destinationCount?: number;
  expandable: boolean;
  expanded: boolean;
  icon: IconName;
  interfaceType?: NetworkVisualizerNode['interfaceType'];
  interfaceState?: NetworkVisualizerNode['interfaceState'];
  kind: NetworkVisualizerNodeKind;
  label: string;
  labelPlacement: NetworkFlowLabelPlacement;
  matched: boolean;
  onopen: (x: number, y: number, method: ContextMenuOpenMethod) => void;
  ontoggle: () => void;
  searchActive: boolean;
  transportNode: boolean;
}

export interface NetworkFlowEdgeData extends Record<string, unknown> {
  kind: NetworkVisualizerEdge['kind'];
  matched: boolean;
  searchActive: boolean;
}

export type RetivumFlowNode = Node<NetworkFlowNodeData, 'network'>;
export type RetivumFlowEdge = Edge<NetworkFlowEdgeData, 'straight'>;

export interface NetworkFlowAdapterOptions {
  ariaLabel: (node: NetworkVisualizerNode) => string;
  label: (node: NetworkVisualizerNode) => string;
  onopen: (node: NetworkVisualizerNode, x: number, y: number, method: ContextMenuOpenMethod) => void;
  ontoggle?: (node: NetworkVisualizerNode) => void;
  searchActive: boolean;
}

interface NodeDimensions {
  width: number;
  height: number;
}

const nodeDimensions: Record<NetworkVisualizerNodeKind, NodeDimensions> = {
  local: { width: 76, height: 76 },
  interface: { width: 62, height: 62 },
  identity: { width: 54, height: 54 },
  nextHop: { width: 54, height: 54 },
  destination: { width: 54, height: 54 },
};
const dimmedConnectionZIndex = 0;
const regularNodeZIndex = 10;
const highlightedConnectionZIndex = 20;
const highlightedNodeZIndex = 30;

function nodeLabelPlacement(node: NetworkVisualizerNode): NetworkFlowLabelPlacement {
  if (node.kind === 'local') return { x: 0, y: 58, anchor: 'middle' };
  if (node.kind === 'interface') return { x: 0, y: 49, anchor: 'middle' };
  return { x: 0, y: 43, anchor: 'middle' };
}

function nodeIcon(node: NetworkVisualizerNode): IconName {
  if (node.kind === 'local') return 'identity';
  if (node.nextHopHash) return 'route';
  if (node.kind === 'identity') return 'identity';
  if (node.kind === 'nextHop') return 'route';
  if (node.kind === 'destination') {
    if (node.fullDestinationName === 'lxmf.delivery' || node.fullDestinationName === 'lxmf.propagation') {
      return 'chat';
    }
    if (node.fullDestinationName === 'nomadnetwork.node') return 'nomadnet';
    if (node.fullDestinationName === 'rnstransport.probe') return 'probe';
    return 'identity';
  }
  if (node.interfaceType === 'rnode') return 'radio';
  if (node.interfaceType === 'tcp' || node.interfaceType === 'udp') return 'network';
  return 'interface';
}

function edgeClass(edge: NetworkVisualizerEdge, searchActive: boolean): string {
  return [
    'network-flow-edge',
    `network-flow-edge-${edge.kind}`,
    searchActive ? (edge.matched ? 'search-match' : 'search-dimmed') : '',
  ].filter(Boolean).join(' ');
}

function edgeLabelStyle(edge: NetworkVisualizerEdge, searchActive: boolean): string {
  const dimmed = searchActive && !edge.matched;
  const matched = searchActive && edge.matched;
  const borderColor = dimmed
    ? 'color-mix(in srgb, var(--border) 16%, var(--surface-1))'
    : matched ? 'var(--warning)' : 'var(--border)';
  const textColor = dimmed
    ? 'color-mix(in srgb, var(--text-muted) 16%, var(--surface-1))'
    : matched ? 'var(--warning)' : 'var(--text-muted)';
  return [
    'padding: 3px 6px',
    'border-radius: 999px',
    `border: 1px solid ${borderColor}`,
    `background: ${dimmed ? 'var(--surface-1)' : 'var(--surface-2)'}`,
    `color: ${textColor}`,
    'font-size: 11px',
    'font-weight: 750',
    'opacity: 1',
    'pointer-events: none',
  ].join(';');
}

export function buildNetworkFlowElements(
  graph: NetworkVisualizerGraph,
  options: NetworkFlowAdapterOptions,
): { nodes: RetivumFlowNode[]; edges: RetivumFlowEdge[] } {
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const nodes = graph.nodes.map((node): RetivumFlowNode => {
    const dimensions = nodeDimensions[node.kind];
    const contextActionable = Boolean(
      (node.kind === 'destination' && node.destinationHash)
      || (node.kind === 'identity' && node.publicKey)
      || node.nextHopHash
      || (node.kind === 'interface' && node.interfaceId)
    );
    const expandable = node.kind === 'identity'
      && Boolean(node.publicKey)
      && (node.destinationCount ?? 0) >= 2;
    return {
      id: node.id,
      type: 'network',
      position: {
        x: node.x - dimensions.width / 2,
        y: node.y - dimensions.height / 2,
      },
      zIndex: options.searchActive && node.matched
        ? highlightedNodeZIndex
        : regularNodeZIndex,
      data: {
        actionable: contextActionable || expandable,
        ariaLabel: options.ariaLabel(node),
        contextActionable,
        destinationCount: node.destinationCount,
        expandable,
        expanded: Boolean(node.expanded),
        icon: nodeIcon(node),
        interfaceType: node.interfaceType,
        interfaceState: node.interfaceState,
        kind: node.kind,
        label: options.label(node),
        labelPlacement: nodeLabelPlacement(node),
        matched: Boolean(node.matched),
        onopen: (x, y, method) => options.onopen(node, x, y, method),
        ontoggle: () => options.ontoggle?.(node),
        searchActive: options.searchActive,
        transportNode: Boolean(node.nextHopHash),
      },
      draggable: true,
      selectable: false,
      connectable: false,
      focusable: false,
      deletable: false,
      width: dimensions.width,
      height: dimensions.height,
    };
  });
  const edges = graph.edges.flatMap((edge): RetivumFlowEdge[] => {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) return [];
    return [{
      id: edge.id,
      type: 'straight',
      source: edge.from,
      target: edge.to,
      sourceHandle: 'source-center',
      targetHandle: 'target-center',
      zIndex: options.searchActive && edge.matched
        ? highlightedConnectionZIndex
        : dimmedConnectionZIndex,
      label: edge.showHopLabel !== false && edge.hops && edge.hops >= 2
        ? String(edge.hops)
        : undefined,
      labelStyle: edgeLabelStyle(edge, options.searchActive),
      class: edgeClass(edge, options.searchActive),
      data: {
        kind: edge.kind,
        matched: Boolean(edge.matched),
        searchActive: options.searchActive,
      },
      selectable: false,
      focusable: false,
      deletable: false,
      interactionWidth: 0,
    }];
  });
  return { nodes, edges };
}

export function preserveNetworkFlowNodePositions(
  nextNodes: readonly RetivumFlowNode[],
  currentNodes: readonly RetivumFlowNode[],
  nodeIds?: ReadonlySet<string>,
): RetivumFlowNode[] {
  const currentPositions = new Map(currentNodes
    .filter((node) => nodeIds?.has(node.id) ?? true)
    .map((node) => [node.id, node.position]));
  return nextNodes.map((node) => {
    const position = currentPositions.get(node.id);
    return position ? { ...node, position: { ...position } } : node;
  });
}

/**
 * Pins expanded identities while adapting their visible destination orbits to
 * path-table updates. A newly discovered highlighted child redistributes every
 * automatically positioned sibling around the pinned identity. Manually
 * positioned nodes remain fixed, and unhighlighted additions do not move
 * existing children.
 */
export function preserveExpandedIdentityNodePositions(
  nextNodes: readonly RetivumFlowNode[],
  currentNodes: readonly RetivumFlowNode[],
  nextEdges: readonly RetivumFlowEdge[],
  identityIds: ReadonlySet<string>,
  additionalPinnedNodeIds: ReadonlySet<string> = new Set(),
): RetivumFlowNode[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  const nextById = new Map(nextNodes.map((node) => [node.id, node]));
  const pinnedNodeIds = new Set(additionalPinnedNodeIds);
  const translatedChildIdentityIds = new Map<string, string>();

  for (const identityId of identityIds) {
    pinnedNodeIds.add(identityId);
    const childIds = nextEdges
      .filter((edge) => (
        edge.source === identityId
        && nextById.get(edge.target)?.data.kind === 'destination'
      ))
      .map((edge) => edge.target);
    const redistributeAutomaticChildren = childIds.some((childId) => (
      !currentById.has(childId) && nextById.get(childId)?.data.matched
    ));
    for (const childId of childIds) {
      if (!currentById.has(childId) || (redistributeAutomaticChildren && !pinnedNodeIds.has(childId))) {
        translatedChildIdentityIds.set(childId, identityId);
      } else {
        pinnedNodeIds.add(childId);
      }
    }
  }

  return nextNodes.map((node) => {
    const current = currentById.get(node.id);
    if (current && pinnedNodeIds.has(node.id)) {
      return { ...node, position: { ...current.position } };
    }
    const identityId = translatedChildIdentityIds.get(node.id);
    if (!identityId) return node;
    const currentIdentity = currentById.get(identityId);
    const nextIdentity = nextById.get(identityId);
    if (!currentIdentity || !nextIdentity) return node;
    return {
      ...node,
      position: {
        x: node.position.x + currentIdentity.position.x - nextIdentity.position.x,
        y: node.position.y + currentIdentity.position.y - nextIdentity.position.y,
      },
    };
  });
}

/**
 * Keeps a logical identity expansion local to all of its visible occurrences.
 * Existing nodes stay exactly where the user currently sees them, while newly
 * inserted destination children retain their computed orbit translated to the
 * matching occurrence's current position. A later explicit Fit network action
 * can still restore the complete collision-safe automatic arrangement.
 */
export function preserveIdentityToggleNodePositions(
  nextNodes: readonly RetivumFlowNode[],
  currentNodes: readonly RetivumFlowNode[],
  nextEdges: readonly RetivumFlowEdge[],
  identityIds: ReadonlySet<string>,
): RetivumFlowNode[] {
  const currentById = new Map(currentNodes.map((node) => [node.id, node]));
  const nextById = new Map(nextNodes.map((node) => [node.id, node]));
  const insertedChildIdentityIds = new Map<string, string>();
  for (const identityId of identityIds) {
    for (const edge of nextEdges) {
      if (edge.source === identityId && !currentById.has(edge.target)) {
        insertedChildIdentityIds.set(edge.target, identityId);
      }
    }
  }

  return nextNodes.map((node) => {
    const current = currentById.get(node.id);
    if (current) return { ...node, position: { ...current.position } };
    const identityId = insertedChildIdentityIds.get(node.id);
    if (!identityId) return node;
    const currentIdentity = currentById.get(identityId);
    const nextIdentity = nextById.get(identityId);
    if (!currentIdentity || !nextIdentity) return node;
    return {
      ...node,
      position: {
        x: node.position.x + currentIdentity.position.x - nextIdentity.position.x,
        y: node.position.y + currentIdentity.position.y - nextIdentity.position.y,
      },
    };
  });
}

export const networkFlowHandlePositions = [
  { name: 'center', position: Position.Left },
] as const;
