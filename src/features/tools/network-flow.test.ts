import { describe, expect, it, vi } from 'vitest';
import type { NetworkVisualizerGraph } from './network-visualizer';
import {
  buildNetworkFlowElements,
  preserveNetworkFlowNodePositions,
} from './network-flow';

const graph: NetworkVisualizerGraph = {
  nodes: [
    { id: 'local', kind: 'local', label: 'Nora', x: 600, y: 450, matched: true },
    {
      id: 'interface:one',
      kind: 'interface',
      label: 'Community hub',
      x: 600,
      y: 300,
      interfaceType: 'websocket',
      interfaceState: 'online',
      matched: true,
    },
    {
      id: 'destination:one',
      kind: 'destination',
      label: 'Field station',
      destinationHash: 'a'.repeat(32),
      fullDestinationName: 'nomadnetwork.node',
      x: 900,
      y: 300,
      matched: false,
    },
  ],
  edges: [
    { id: 'interface-edge', from: 'local', to: 'interface:one', kind: 'interface', matched: true },
    {
      id: 'route-edge',
      from: 'interface:one',
      to: 'destination:one',
      kind: 'route',
      hops: 3,
      matched: false,
    },
    {
      id: 'two-hop-edge',
      from: 'interface:one',
      to: 'destination:one',
      kind: 'route',
      hops: 2,
      matched: false,
    },
  ],
  pathCount: 1,
  hiddenPathCount: 0,
  matchedPathCount: 0,
  bounds: { x: 400, y: 200, width: 700, height: 500 },
};

describe('Svelte Flow network adapter', () => {
  it('preserves the automatic graph positions for fixed-size, icon-led custom nodes', () => {
    const elements = buildNetworkFlowElements(graph, {
      ariaLabel: (node) => `Node ${node.label}`,
      label: (node) => node.label,
      onopen: vi.fn(),
      searchActive: false,
    });

    const local = elements.nodes.find((node) => node.id === 'local')!;
    const interfaceNode = elements.nodes.find((node) => node.id === 'interface:one')!;
    const destination = elements.nodes.find((node) => node.id === 'destination:one')!;

    expect(local).toEqual(expect.objectContaining({
      width: 76,
      height: 76,
      type: 'network',
      draggable: true,
    }));
    expect(interfaceNode).toEqual(expect.objectContaining({
      width: 62,
      height: 62,
    }));
    expect(local.position).toEqual({ x: 562, y: 412 });
    expect(interfaceNode.position).toEqual({ x: 569, y: 269 });
    expect(destination.position).toEqual({ x: 873, y: 273 });
    expect(local.data.icon).toBe('identity');
    expect(interfaceNode.data.icon).toBe('interface');
    expect(destination.data.icon).toBe('nomadnet');
    const probeDestination = buildNetworkFlowElements({
      ...graph,
      nodes: graph.nodes.map((node) => node.kind === 'destination'
        ? { ...node, fullDestinationName: 'rnstransport.probe' }
        : node),
    }, {
      ariaLabel: (node) => `Node ${node.label}`,
      label: (node) => node.label,
      onopen: vi.fn(),
      searchActive: false,
    }).nodes.find((node) => node.id === 'destination:one')!;
    expect(probeDestination.data.icon).toBe('probe');
    expect(elements.edges.find((edge) => edge.id === 'interface-edge')).toEqual(expect.objectContaining({
      sourceHandle: 'source-center',
      targetHandle: 'target-center',
      type: 'straight',
    }));
    expect(elements.edges.find((edge) => edge.id === 'route-edge')).toEqual(expect.objectContaining({
      sourceHandle: 'source-center',
      targetHandle: 'target-center',
      label: '3',
    }));
    expect(elements.edges.find((edge) => edge.id === 'two-hop-edge')?.label).toBeUndefined();

    const relayout = buildNetworkFlowElements({
      ...graph,
      nodes: graph.nodes.map((node, index) => ({
        ...node,
        x: 2_000 - index * 400,
        y: -1_000 + index * 700,
      })),
    }, {
      ariaLabel: (node) => `Node ${node.label}`,
      label: (node) => node.label,
      onopen: vi.fn(),
      searchActive: false,
    });
    expect(relayout.nodes.map((node) => node.position))
      .not.toEqual(elements.nodes.map((node) => node.position));
  });

  it('marks complete matching routes and dims unmatched route context', () => {
    const elements = buildNetworkFlowElements(graph, {
      ariaLabel: (node) => `Node ${node.label}`,
      label: (node) => node.label,
      onopen: vi.fn(),
      searchActive: true,
    });

    expect(elements.edges.find((edge) => edge.id === 'interface-edge')?.class)
      .toContain('search-match');
    expect(elements.edges.find((edge) => edge.id === 'route-edge')?.class)
      .toContain('search-dimmed');
    expect(elements.edges.find((edge) => edge.id === 'route-edge')?.labelStyle)
      .toContain('color-mix(in srgb, var(--text-muted) 16%, var(--surface-1))');
    expect(elements.edges.find((edge) => edge.id === 'route-edge')?.labelStyle)
      .toContain('opacity: 1');
    expect(elements.nodes.find((node) => node.id === 'destination:one')?.data)
      .toEqual(expect.objectContaining({ matched: false, searchActive: true }));
  });

  it('updates search presentation without replacing dragged node positions', () => {
    const current = buildNetworkFlowElements(graph, {
      ariaLabel: (node) => `Node ${node.label}`,
      label: (node) => node.label,
      onopen: vi.fn(),
      searchActive: false,
    }).nodes.map((node) => (
      node.id === 'destination:one'
        ? { ...node, position: { x: 1_240, y: -360 } }
        : node
    ));
    const highlighted = buildNetworkFlowElements({
      ...graph,
      nodes: graph.nodes.map((node) => ({ ...node, matched: node.id === 'destination:one' })),
    }, {
      ariaLabel: (node) => `Node ${node.label}`,
      label: (node) => node.label,
      onopen: vi.fn(),
      searchActive: true,
    }).nodes;

    const synchronized = preserveNetworkFlowNodePositions(highlighted, current);
    const destination = synchronized.find((node) => node.id === 'destination:one')!;

    expect(destination.position).toEqual({ x: 1_240, y: -360 });
    expect(destination.data).toEqual(expect.objectContaining({ matched: true, searchActive: true }));
  });

  it('preserves only explicitly dragged nodes across topology updates', () => {
    const current = buildNetworkFlowElements(graph, {
      ariaLabel: (node) => `Node ${node.label}`,
      label: (node) => node.label,
      onopen: vi.fn(),
      searchActive: false,
    }).nodes.map((node) => ({
      ...node,
      position: node.id === 'destination:one'
        ? { x: 1_240, y: -360 }
        : { x: -480, y: 920 },
    }));
    const next = buildNetworkFlowElements(graph, {
      ariaLabel: (node) => `Node ${node.label}`,
      label: (node) => node.label,
      onopen: vi.fn(),
      searchActive: false,
    }).nodes;
    const automaticPosition = next.find((node) => node.id === 'local')!.position;

    const synchronized = preserveNetworkFlowNodePositions(
      next,
      current,
      new Set(['destination:one']),
    );

    expect(synchronized.find((node) => node.id === 'destination:one')?.position)
      .toEqual({ x: 1_240, y: -360 });
    expect(synchronized.find((node) => node.id === 'local')?.position)
      .toEqual(automaticPosition);
  });
});
