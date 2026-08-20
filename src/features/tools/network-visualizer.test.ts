import { describe, expect, it } from 'vitest';
import type { InterfaceConfig } from '../../domain/settings';
import { buildNetworkVisualizerGraph } from './network-visualizer';

const websocket: InterfaceConfig = {
  id: 'websocket-1',
  schemaVersion: 5,
  createdAt: '2026-08-20T00:00:00.000Z',
  name: 'Community hub',
  enabled: true,
  type: 'websocket',
  mode: 'full',
  reannounceOnReconnect: false,
  ifac: { networkName: '', passphrase: '', credentialRevision: 'test' },
  connection: { scheme: 'wss', host: 'example.test', path: '/' },
};

describe('network visualizer graph', () => {
  it('settles a deterministic spring layout around the fixed local identity', () => {
    const secondInterface: InterfaceConfig = {
      ...websocket,
      id: 'websocket-2',
      name: 'Field relay',
    };
    const graph = buildNetworkVisualizerGraph({
      interfaces: [websocket, secondInterface],
      interfaceStatuses: {},
      paths: [
        { destinationHash: '8'.repeat(32), hops: 1, interfaceId: websocket.id },
        { destinationHash: '9'.repeat(32), hops: 1, interfaceId: secondInterface.id },
      ],
      destinations: [],
    });
    const local = graph.nodes.find((node) => node.kind === 'local')!;
    const interfaces = graph.nodes.filter((node) => node.kind === 'interface');
    const destinations = graph.nodes.filter((node) => node.kind === 'destination');
    const radiusFromLocal = (node: (typeof graph.nodes)[number]): number => (
      Math.hypot(node.x - local.x, node.y - local.y)
    );

    expect(interfaces).toHaveLength(2);
    expect(destinations).toHaveLength(2);
    expect(local).toEqual(expect.objectContaining({ x: 600, y: 450 }));
    expect(interfaces.every((node) => radiusFromLocal(node) > 100)).toBe(true);
    const interfaceRadii = interfaces.map(radiusFromLocal);
    expect(Math.max(...interfaceRadii) - Math.min(...interfaceRadii)).toBeLessThan(5);

    const rebuilt = buildNetworkVisualizerGraph({
      interfaces: [websocket, secondInterface],
      interfaceStatuses: {},
      paths: [
        { destinationHash: '8'.repeat(32), hops: 1, interfaceId: websocket.id },
        { destinationHash: '9'.repeat(32), hops: 1, interfaceId: secondInterface.id },
      ],
      destinations: [],
    });
    expect(rebuilt.nodes.map(({ id, x, y }) => ({ id, x, y })))
      .toEqual(graph.nodes.map(({ id, x, y }) => ({ id, x, y })));
  });

  it('uses collision spacing to separate a crowded route branch', () => {
    const interfaces = Array.from({ length: 5 }, (_, index): InterfaceConfig => ({
      ...websocket,
      id: `websocket-${index + 1}`,
      name: index === 0 ? 'Busy hub' : `Quiet interface ${index}`,
    }));
    const graph = buildNetworkVisualizerGraph({
      interfaces,
      interfaceStatuses: {},
      paths: Array.from({ length: 10 }, (_, index) => ({
        destinationHash: index.toString(16).repeat(32),
        nextHop: 'f'.repeat(32),
        hops: 3,
        interfaceId: interfaces[0].id,
      })),
      destinations: [],
    });
    const local = graph.nodes.find((node) => node.kind === 'local')!;
    const busyInterface = graph.nodes.find((node) => node.id === `interface:${interfaces[0].id}`)!;
    const nextHop = graph.nodes.find((node) => node.kind === 'nextHop')!;
    const destinations = graph.nodes.filter((node) => node.kind === 'destination');
    const radii = destinations.map((node) => Math.round(Math.hypot(node.x - local.x, node.y - local.y)));
    const pairDistances = destinations.flatMap((node, index) => (
      destinations.slice(index + 1).map((other) => Math.hypot(node.x - other.x, node.y - other.y))
    ));

    expect(new Set(radii).size).toBeGreaterThan(1);
    expect(Math.min(...pairDistances)).toBeGreaterThan(90);
    const interfaceDistance = Math.hypot(busyInterface.x - local.x, busyInterface.y - local.y);
    const radialProjection = (node: (typeof graph.nodes)[number]): number => (
      (node.x - local.x) * (busyInterface.x - local.x) / interfaceDistance
      + (node.y - local.y) * (busyInterface.y - local.y) / interfaceDistance
    );
    expect(radialProjection(nextHop)).toBeGreaterThan(radialProjection(busyInterface));
    expect(destinations.some((node) => radialProjection(node) > radialProjection(nextHop))).toBe(true);
    expect(destinations.some((node) => radialProjection(node) < radialProjection(nextHop))).toBe(true);
  });

  it('alternates crowded leaf edge lengths without intersecting node bubbles', () => {
    const nextHopHash = 'f'.repeat(32);
    const graph = buildNetworkVisualizerGraph({
      interfaces: [websocket],
      interfaceStatuses: {},
      paths: Array.from({ length: 10 }, (_, index) => ({
        destinationHash: index.toString(16).repeat(32),
        nextHop: nextHopHash,
        hops: 3,
        interfaceId: websocket.id,
      })),
      destinations: [],
    });
    const nextHop = graph.nodes.find((node) => node.kind === 'nextHop')!;
    const childIds = new Set(graph.edges
      .filter((edge) => edge.from === nextHop.id)
      .map((edge) => edge.to));
    const children = graph.nodes.filter((node) => childIds.has(node.id));
    const edgeLengths = children.map((node) => (
      Math.hypot(node.x - nextHop.x, node.y - nextHop.y)
    ));
    const bubbleDistances = children.flatMap((node, index) => (
      children.slice(index + 1).map((other) => (
        Math.hypot(node.x - other.x, node.y - other.y)
      ))
    ));

    expect(children).toHaveLength(10);
    expect(Math.min(...edgeLengths)).toBeLessThan(Math.max(...edgeLengths) * .85);
    expect(Math.min(...edgeLengths)).toBeGreaterThan(95);
    expect(Math.min(...bubbleDistances)).toBeGreaterThan(110);
  });

  it('uses several compact edge-length layers for a very large leaf branch', () => {
    const nextHopHash = 'e'.repeat(32);
    const graph = buildNetworkVisualizerGraph({
      interfaces: [websocket],
      interfaceStatuses: {},
      paths: Array.from({ length: 80 }, (_, index) => ({
        destinationHash: `large-${index.toString().padStart(3, '0')}`,
        nextHop: nextHopHash,
        hops: 5,
        interfaceId: websocket.id,
      })),
      destinations: [],
    });
    const nextHop = graph.nodes.find((node) => node.kind === 'nextHop')!;
    const childIds = new Set(graph.edges
      .filter((edge) => edge.from === nextHop.id)
      .map((edge) => edge.to));
    const children = graph.nodes.filter((node) => childIds.has(node.id));
    const edgeLengths = children
      .map((node) => Math.hypot(node.x - nextHop.x, node.y - nextHop.y))
      .sort((left, right) => left - right);
    const separatedLayers = edgeLengths.reduce<number[]>((layers, distance) => {
      if (!layers.some((layer) => Math.abs(layer - distance) < 20)) layers.push(distance);
      return layers;
    }, []);
    const bubbleDistances = children.flatMap((node, index) => (
      children.slice(index + 1).map((other) => (
        Math.hypot(node.x - other.x, node.y - other.y)
      ))
    ));

    expect(children).toHaveLength(80);
    expect(separatedLayers.length).toBeGreaterThanOrEqual(4);
    expect(Math.min(...bubbleDistances)).toBeGreaterThan(100);
  });

  it('counts the parent edge when dividing child angles around a branch node', () => {
    for (const childCount of [1, 2, 3]) {
      const nextHopHash = 'd'.repeat(32);
      const graph = buildNetworkVisualizerGraph({
        interfaces: [websocket],
        interfaceStatuses: {},
        paths: Array.from({ length: childCount }, (_, index) => ({
          destinationHash: `${index + 1}`.repeat(32),
          nextHop: nextHopHash,
          hops: 3,
          interfaceId: websocket.id,
        })),
        destinations: [],
      });
      const parent = graph.nodes.find((node) => node.id === `interface:${websocket.id}`)!;
      const branch = graph.nodes.find((node) => node.kind === 'nextHop')!;
      const children = graph.nodes.filter((node) => node.kind === 'destination');
      const angles = [parent, ...children]
        .map((node) => Math.atan2(node.y - branch.y, node.x - branch.x))
        .sort((left, right) => left - right);
      const gaps = angles.map((angle, index) => {
        const next = angles[(index + 1) % angles.length]
          + (index === angles.length - 1 ? Math.PI * 2 : 0);
        return next - angle;
      });
      const expectedGap = Math.PI * 2 / (childCount + 1);

      expect(gaps.every((gap) => Math.abs(gap - expectedGap) < .25)).toBe(true);
    }
  });

  it('grows crowded child circles recursively and keeps descendant circles outside ancestor circles', () => {
    const interfaces = Array.from({ length: 5 }, (_, index): InterfaceConfig => ({
      ...websocket,
      id: `recursive-interface-${index}`,
      name: `Interface ${index}`,
    }));
    const branchInterface = interfaces[2];
    const nextHopHash = 'e'.repeat(32);
    const directDestinationHash = 'f'.repeat(32);
    const build = (childCount: number) => buildNetworkVisualizerGraph({
      interfaces,
      interfaceStatuses: {},
      paths: [
        {
          destinationHash: directDestinationHash,
          hops: 1,
          interfaceId: branchInterface.id,
        },
        ...Array.from({ length: childCount }, (_, index) => ({
          destinationHash: `${index + 1}`.repeat(32),
          nextHop: nextHopHash,
          hops: 3,
          interfaceId: branchInterface.id,
        })),
      ],
      destinations: [],
    });
    const childRadius = (graph: ReturnType<typeof buildNetworkVisualizerGraph>): number => {
      const nextHop = graph.nodes.find((node) => node.kind === 'nextHop')!;
      const childIds = new Set(graph.edges
        .filter((edge) => edge.from === nextHop.id)
        .map((edge) => edge.to));
      const destinations = graph.nodes.filter((node) => childIds.has(node.id));
      return destinations.reduce((sum, node) => (
        sum + Math.hypot(node.x - nextHop.x, node.y - nextHop.y)
      ), 0) / destinations.length;
    };
    const sparseRadius = childRadius(build(1));
    const crowded = build(7);
    const crowdedRadius = childRadius(crowded);
    const local = crowded.nodes.find((node) => node.kind === 'local')!;
    const branch = crowded.nodes.find((node) => node.id === `interface:${branchInterface.id}`)!;
    const nextHop = crowded.nodes.find((node) => node.kind === 'nextHop')!;
    const leafInterface = crowded.nodes.find((node) => node.id === `interface:${interfaces[0].id}`)!;
    const directDestination = crowded.nodes.find((node) => (
      node.destinationHash === directDestinationHash
    ))!;
    const rootRadius = Math.hypot(leafInterface.x - local.x, leafInterface.y - local.y);
    const interfaceRadius = Math.hypot(
      directDestination.x - branch.x,
      directDestination.y - branch.y,
    );
    const localToBranch = Math.hypot(branch.x - local.x, branch.y - local.y);
    const branchToNextHop = Math.hypot(nextHop.x - branch.x, nextHop.y - branch.y);

    expect(sparseRadius).toBeLessThan(150);
    expect(crowdedRadius).toBeGreaterThan(sparseRadius + 10);
    expect(localToBranch).toBeGreaterThanOrEqual(rootRadius + interfaceRadius - 10);
    expect(branchToNextHop).toBeGreaterThanOrEqual(interfaceRadius + crowdedRadius - 10);
  });

  it('projects local identity, interfaces, next hops, and destinations without inventing intermediate routers', () => {
    const destination = 'a'.repeat(32);
    const nextHop = 'b'.repeat(32);
    const graph = buildNetworkVisualizerGraph({
      identity: {
        id: 'identity-1',
        displayName: 'Nora',
        identityHashHex: 'c'.repeat(32),
        publicKeyHex: 'd'.repeat(64),
      },
      interfaces: [websocket],
      interfaceStatuses: { 'websocket-1': 'online' },
      paths: [{ destinationHash: destination, hops: 3, nextHop, interfaceId: 'websocket-1' }],
      destinations: [{
        destinationHash: destination,
        displayName: 'Field station',
        fullDestinationName: 'nomadnetwork.node',
      }],
    });

    expect(graph.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'local', label: 'Nora', kind: 'local' }),
      expect.objectContaining({ id: 'interface:websocket-1', label: 'Community hub', interfaceState: 'online' }),
      expect.objectContaining({ id: `next-hop:websocket-1:${nextHop}`, nextHopHash: nextHop }),
      expect.objectContaining({ id: `destination:${destination}`, label: 'Field station', hops: 3 }),
    ]));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: 'local', to: 'interface:websocket-1', kind: 'interface' }),
      expect.objectContaining({ from: `next-hop:websocket-1:${nextHop}`, to: `destination:${destination}`, hops: 3 }),
    ]));
    expect(graph.nodes.filter((node) => node.kind === 'nextHop')).toHaveLength(1);
  });

  it('classifies an inventory-only probe destination with the shared presentation resolver', () => {
    const destination = '7'.repeat(32);
    const graph = buildNetworkVisualizerGraph({
      interfaces: [websocket],
      interfaceStatuses: { [websocket.id]: 'online' },
      paths: [{ destinationHash: destination, hops: 1, interfaceId: websocket.id }],
      destinations: [],
      destinationInventory: [{
        destinationHash: destination,
        fullDestinationName: 'rnstransport.probe',
      }],
    });

    expect(graph.nodes.find((node) => node.id === `destination:${destination}`))
      .toEqual(expect.objectContaining({
        destinationHash: destination,
        fullDestinationName: 'rnstransport.probe',
      }));
  });

  it('shares an immediate next-hop node and prefers a local contact name', () => {
    const nextHop = 'e'.repeat(32);
    const first = '1'.repeat(32);
    const second = '2'.repeat(32);
    const graph = buildNetworkVisualizerGraph({
      interfaces: [websocket],
      interfaceStatuses: {},
      paths: [
        { destinationHash: first, hops: 2, nextHop, interfaceId: 'websocket-1' },
        { destinationHash: second, hops: 4, nextHop, interfaceId: 'websocket-1' },
      ],
      destinations: [{ destinationHash: first, displayName: 'Announced name' }],
      contacts: [{
        id: 'identity-1:contact-1',
        identityId: 'identity-1',
        destinationHash: first,
        name: 'My station name',
        createdAt: '',
        updatedAt: '',
      }],
    });

    expect(graph.nodes.filter((node) => node.kind === 'nextHop')).toHaveLength(1);
    expect(graph.nodes.find((node) => node.id === `destination:${first}`)?.label).toBe('My station name');
    expect(graph.edges.filter((edge) => edge.from === `next-hop:websocket-1:${nextHop}`)).toHaveLength(2);
  });

  it('keeps unmatched routes visible while marking the complete matching route context', () => {
    const input = {
      interfaces: [websocket],
      interfaceStatuses: {},
      paths: [
        { destinationHash: '3'.repeat(32), hops: 1, interfaceId: 'websocket-1' },
        { destinationHash: '4'.repeat(32), hops: 2, interfaceId: 'websocket-1' },
        { destinationHash: '5'.repeat(32), hops: 3, interfaceId: 'websocket-1' },
      ],
      destinations: [
        { destinationHash: '3'.repeat(32), displayName: 'Alpha' },
        { destinationHash: '4'.repeat(32), displayName: 'Bravo' },
        { destinationHash: '5'.repeat(32), displayName: 'Charlie' },
      ],
      search: 'bravo',
      maximumHops: 2,
      pathLimit: 3,
    } as const;
    const graph = buildNetworkVisualizerGraph(input);

    expect(graph.pathCount).toBe(2);
    expect(graph.hiddenPathCount).toBe(0);
    expect(graph.matchedPathCount).toBe(1);
    expect(graph.nodes.find((node) => node.id === 'local')?.matched).toBe(true);
    expect(graph.nodes.find((node) => node.id === 'interface:websocket-1')?.matched).toBe(true);
    expect(graph.nodes.find((node) => node.label === 'Bravo')?.matched).toBe(true);
    expect(graph.nodes.find((node) => node.label === 'Alpha')?.matched).toBe(false);
    expect(graph.edges.some((edge) => edge.to === `destination:${'4'.repeat(32)}` && edge.matched)).toBe(true);
    expect(graph.edges.some((edge) => edge.to === `destination:${'3'.repeat(32)}` && !edge.matched)).toBe(true);

    const unsearched = buildNetworkVisualizerGraph({ ...input, search: '' });
    expect(graph.nodes.map(({ id, x, y }) => ({ id, x, y })))
      .toEqual(unsearched.nodes.map(({ id, x, y }) => ({ id, x, y })));
  });

  it('keeps a bounded graph and reports omitted matching paths', () => {
    const graph = buildNetworkVisualizerGraph({
      interfaces: [websocket],
      interfaceStatuses: {},
      paths: Array.from({ length: 4 }, (_, index) => ({
        destinationHash: `${index}`.repeat(32),
        hops: index + 1,
        interfaceId: 'websocket-1',
      })),
      destinations: [],
      pathLimit: 2,
    });

    expect(graph.pathCount).toBe(2);
    expect(graph.hiddenPathCount).toBe(2);
    expect(graph.nodes.filter((node) => node.kind === 'destination')).toHaveLength(2);
  });
});
