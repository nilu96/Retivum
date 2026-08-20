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
  icon: IconName;
  interfaceType?: NetworkVisualizerNode['interfaceType'];
  interfaceState?: NetworkVisualizerNode['interfaceState'];
  kind: NetworkVisualizerNodeKind;
  label: string;
  labelPlacement: NetworkFlowLabelPlacement;
  matched: boolean;
  onopen: (x: number, y: number, method: ContextMenuOpenMethod) => void;
  searchActive: boolean;
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
  searchActive: boolean;
}

interface NodeDimensions {
  width: number;
  height: number;
}

const nodeDimensions: Record<NetworkVisualizerNodeKind, NodeDimensions> = {
  local: { width: 76, height: 76 },
  interface: { width: 62, height: 62 },
  nextHop: { width: 54, height: 54 },
  destination: { width: 54, height: 54 },
};

function nodeLabelPlacement(node: NetworkVisualizerNode): NetworkFlowLabelPlacement {
  if (node.kind === 'local') return { x: 0, y: 58, anchor: 'middle' };
  if (node.kind === 'interface') return { x: 0, y: 49, anchor: 'middle' };
  return { x: 0, y: 43, anchor: 'middle' };
}

function nodeIcon(node: NetworkVisualizerNode): IconName {
  if (node.kind === 'local') return 'identity';
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
    return {
      id: node.id,
      type: 'network',
      position: {
        x: node.x - dimensions.width / 2,
        y: node.y - dimensions.height / 2,
      },
      data: {
        actionable: Boolean(
          (node.kind === 'destination' && node.destinationHash)
          || (node.kind === 'nextHop' && node.nextHopHash)
          || (node.kind === 'interface' && node.interfaceId)
        ),
        ariaLabel: options.ariaLabel(node),
        icon: nodeIcon(node),
        interfaceType: node.interfaceType,
        interfaceState: node.interfaceState,
        kind: node.kind,
        label: options.label(node),
        labelPlacement: nodeLabelPlacement(node),
        matched: Boolean(node.matched),
        onopen: (x, y, method) => options.onopen(node, x, y, method),
        searchActive: options.searchActive,
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
      label: edge.hops && edge.hops > 2 ? String(edge.hops) : undefined,
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

export const networkFlowHandlePositions = [
  { name: 'center', position: Position.Left },
] as const;
