import { describe, expect, it, vi } from 'vitest';
import type { NetworkVisualizerGraph } from './network-visualizer';
import {
  buildNetworkFlowElements,
  preserveExpandedIdentityNodePositions,
  preserveIdentityToggleNodePositions,
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
    const toggleIdentity = vi.fn();
    const identity = buildNetworkFlowElements({
      ...graph,
      nodes: [
        ...graph.nodes,
        {
          id: `identity:${'f'.repeat(128)}`,
          kind: 'identity',
          label: 'Field identity',
          publicKey: 'f'.repeat(128),
          identityHash: 'e'.repeat(32),
          destinationCount: 2,
          expanded: false,
          x: 720,
          y: 520,
        },
      ],
    }, {
      ariaLabel: (node) => `Node ${node.label}`,
      label: (node) => node.label,
      onopen: vi.fn(),
      ontoggle: toggleIdentity,
      searchActive: false,
    }).nodes.find((node) => node.data.kind === 'identity')!;
    expect(identity).toEqual(expect.objectContaining({ width: 54, height: 54 }));
    expect(identity.data).toEqual(expect.objectContaining({
      actionable: true,
      contextActionable: true,
      destinationCount: 2,
      expandable: true,
      expanded: false,
      icon: 'identity',
    }));
    identity.data.ontoggle();
    expect(toggleIdentity).toHaveBeenCalledWith(expect.objectContaining({
      publicKey: 'f'.repeat(128),
    }));
    const transportIdentity = buildNetworkFlowElements({
      ...graph,
      nodes: [{
        id: `identity:${'a'.repeat(128)}`,
        kind: 'identity',
        label: 'Direct transport identity',
        publicKey: 'a'.repeat(128),
        identityHash: 'b'.repeat(32),
        nextHopHash: 'b'.repeat(32),
        x: 720,
        y: 520,
      }],
    }, {
      ariaLabel: (node) => `Node ${node.label}`,
      label: (node) => node.label,
      onopen: vi.fn(),
      searchActive: false,
    }).nodes[0];
    expect(transportIdentity.data).toEqual(expect.objectContaining({
      actionable: true,
      icon: 'route',
      transportNode: true,
    }));
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
    expect(elements.edges.find((edge) => edge.id === 'two-hop-edge')?.label).toBe('2');

    const membershipEdge = buildNetworkFlowElements({
      ...graph,
      edges: [{
        id: 'identity-membership-edge',
        from: 'interface:one',
        to: 'destination:one',
        kind: 'direct',
        hops: 2,
        showHopLabel: false,
      }],
    }, {
      ariaLabel: (node) => `Node ${node.label}`,
      label: (node) => node.label,
      onopen: vi.fn(),
      searchActive: false,
    }).edges[0];
    expect(membershipEdge.label).toBeUndefined();

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
    expect(elements.edges.find((edge) => edge.id === 'interface-edge')?.zIndex).toBe(20);
    expect(elements.edges.find((edge) => edge.id === 'route-edge')?.class)
      .toContain('search-dimmed');
    expect(elements.edges.find((edge) => edge.id === 'route-edge')?.zIndex).toBe(0);
    expect(elements.edges.find((edge) => edge.id === 'route-edge')?.labelStyle)
      .toContain('color-mix(in srgb, var(--text-muted) 16%, var(--surface-1))');
    expect(elements.edges.find((edge) => edge.id === 'route-edge')?.labelStyle)
      .toContain('opacity: 1');
    expect(elements.nodes.find((node) => node.id === 'destination:one')?.data)
      .toEqual(expect.objectContaining({ matched: false, searchActive: true }));
    expect(elements.nodes.find((node) => node.id === 'local')?.zIndex).toBe(30);
    expect(elements.nodes.find((node) => node.id === 'interface:one')?.zIndex).toBe(30);
    expect(elements.nodes.find((node) => node.id === 'destination:one')?.zIndex).toBe(10);
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

  it('keeps existing nodes fixed and translates newly expanded children to the current identity', () => {
    const identityId = `identity:${'f'.repeat(128)}`;
    const collapsedGraph: NetworkVisualizerGraph = {
      ...graph,
      nodes: [
        graph.nodes[0],
        {
          id: identityId,
          kind: 'identity',
          label: 'eeeeeeee…eeeeee',
          publicKey: 'f'.repeat(128),
          identityHash: 'e'.repeat(32),
          destinationCount: 2,
          expanded: false,
          x: 760,
          y: 520,
        },
      ],
      edges: [{ id: 'local~identity', from: 'local', to: identityId, kind: 'direct' }],
    };
    const options = {
      ariaLabel: (node: NetworkVisualizerGraph['nodes'][number]) => `Node ${node.label}`,
      label: (node: NetworkVisualizerGraph['nodes'][number]) => node.label,
      onopen: vi.fn(),
      searchActive: false,
    };
    const current = buildNetworkFlowElements(collapsedGraph, options).nodes.map((node) => ({
      ...node,
      position: node.id === identityId ? { x: 1_200, y: 300 } : { x: 80, y: 90 },
    }));
    const expandedGraph: NetworkVisualizerGraph = {
      ...collapsedGraph,
      nodes: [
        { ...collapsedGraph.nodes[0], x: 200, y: 220 },
        { ...collapsedGraph.nodes[1], expanded: true, x: 500, y: 400 },
        {
          id: 'destination:child',
          kind: 'destination',
          label: 'Child',
          destinationHash: 'c'.repeat(32),
          x: 650,
          y: 460,
        },
      ],
      edges: [
        collapsedGraph.edges[0],
        { id: 'identity~child', from: identityId, to: 'destination:child', kind: 'route' },
      ],
    };
    const next = buildNetworkFlowElements(expandedGraph, options);
    const nextIdentityPosition = next.nodes.find((node) => node.id === identityId)!.position;
    const automaticChildPosition = next.nodes.find((node) => node.id === 'destination:child')!.position;
    const synchronized = preserveIdentityToggleNodePositions(
      next.nodes,
      current,
      next.edges,
      new Set([identityId]),
    );

    expect(synchronized.find((node) => node.id === 'local')?.position).toEqual({ x: 80, y: 90 });
    expect(synchronized.find((node) => node.id === identityId)?.position)
      .toEqual({ x: 1_200, y: 300 });
    expect(synchronized.find((node) => node.id === 'destination:child')?.position).toEqual({
      x: automaticChildPosition.x + 1_200 - nextIdentityPosition.x,
      y: automaticChildPosition.y + 300 - nextIdentityPosition.y,
    });
  });

  it('redistributes automatic expanded children while preserving dragged positions', () => {
    const identityId = `identity:${'f'.repeat(128)}`;
    const childId = 'destination:child';
    const newChildId = 'destination:new-child';
    const options = {
      ariaLabel: (node: NetworkVisualizerGraph['nodes'][number]) => `Node ${node.label}`,
      label: (node: NetworkVisualizerGraph['nodes'][number]) => node.label,
      onopen: vi.fn(),
      searchActive: true,
    };
    const currentGraph: NetworkVisualizerGraph = {
      ...graph,
      nodes: [
        graph.nodes[0],
        {
          id: identityId,
          kind: 'identity',
          label: 'eeeeeeee…eeeeee',
          publicKey: 'f'.repeat(128),
          destinationCount: 2,
          expanded: true,
          x: 700,
          y: 500,
          matched: true,
        },
        {
          id: childId,
          kind: 'destination',
          label: 'Existing child',
          destinationHash: 'c'.repeat(32),
          x: 820,
          y: 560,
          matched: true,
        },
      ],
      edges: [
        { id: 'local~identity', from: 'local', to: identityId, kind: 'direct', matched: true },
        { id: 'identity~child', from: identityId, to: childId, kind: 'route', matched: true },
      ],
    };
    const current = buildNetworkFlowElements(currentGraph, options).nodes.map((node) => ({
      ...node,
      position: node.id === identityId
        ? { x: 1_100, y: 260 }
        : node.id === childId ? { x: 1_260, y: 330 } : { x: 40, y: 50 },
    }));
    const nextGraph: NetworkVisualizerGraph = {
      ...currentGraph,
      nodes: [
        { ...currentGraph.nodes[0], x: 300, y: 200 },
        { ...currentGraph.nodes[1], destinationCount: 3, x: 520, y: 420 },
        { ...currentGraph.nodes[2], x: 680, y: 480 },
        {
          id: newChildId,
          kind: 'destination',
          label: 'New child',
          destinationHash: 'd'.repeat(32),
          x: 440,
          y: 570,
          matched: true,
        },
      ],
      edges: [
        ...currentGraph.edges,
        { id: 'identity~new-child', from: identityId, to: newChildId, kind: 'route', matched: true },
      ],
    };
    const next = buildNetworkFlowElements(nextGraph, options);
    const automaticIdentity = next.nodes.find((node) => node.id === identityId)!;
    const automaticChild = next.nodes.find((node) => node.id === childId)!;
    const automaticNewChild = next.nodes.find((node) => node.id === newChildId)!;
    const synchronized = preserveExpandedIdentityNodePositions(
      next.nodes,
      current,
      next.edges,
      new Set([identityId]),
    );

    expect(synchronized.find((node) => node.id === identityId)?.position)
      .toEqual({ x: 1_100, y: 260 });
    expect(synchronized.find((node) => node.id === childId)?.position).toEqual({
      x: automaticChild.position.x + 1_100 - automaticIdentity.position.x,
      y: automaticChild.position.y + 260 - automaticIdentity.position.y,
    });
    expect(synchronized.find((node) => node.id === newChildId)?.position).toEqual({
      x: automaticNewChild.position.x + 1_100 - automaticIdentity.position.x,
      y: automaticNewChild.position.y + 260 - automaticIdentity.position.y,
    });
    expect(synchronized.find((node) => node.id === 'local')?.position)
      .toEqual(next.nodes.find((node) => node.id === 'local')?.position);

    const withDraggedChild = preserveExpandedIdentityNodePositions(
      next.nodes,
      current,
      next.edges,
      new Set([identityId]),
      new Set([childId]),
    );
    expect(withDraggedChild.find((node) => node.id === childId)?.position)
      .toEqual({ x: 1_260, y: 330 });

    const unhighlightedNext = buildNetworkFlowElements({
      ...nextGraph,
      nodes: nextGraph.nodes.map((node) => (
        node.id === newChildId ? { ...node, matched: false } : node
      )),
    }, options);
    const withUnhighlightedChild = preserveExpandedIdentityNodePositions(
      unhighlightedNext.nodes,
      current,
      unhighlightedNext.edges,
      new Set([identityId]),
    );
    expect(withUnhighlightedChild.find((node) => node.id === childId)?.position)
      .toEqual({ x: 1_260, y: 330 });
  });
});
