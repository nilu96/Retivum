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
      expect.objectContaining({
        id: 'local',
        label: 'Nora',
        kind: 'local',
      }),
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

  it('does not use an identity-shared name for visualization labels', () => {
    const nomadDestination = '6'.repeat(32);
    const deliveryDestination = '7'.repeat(32);
    const publicKey = 'e'.repeat(128);
    const graph = buildNetworkVisualizerGraph({
      interfaces: [websocket],
      interfaceStatuses: {},
      paths: [{
        destinationHash: deliveryDestination,
        hops: 1,
        interfaceId: websocket.id,
      }],
      destinations: [
        {
          destinationHash: nomadDestination,
          displayName: 'Shared device name',
          fullDestinationName: 'nomadnetwork.node',
        },
        {
          destinationHash: deliveryDestination,
          fullDestinationName: 'lxmf.delivery',
        },
      ],
      destinationInventory: [
        { destinationHash: nomadDestination, publicKey, identityHash: 'd'.repeat(32) },
        { destinationHash: deliveryDestination, publicKey, identityHash: 'd'.repeat(32) },
      ],
    });

    expect(graph.nodes.find((node) => node.destinationHash === deliveryDestination)?.label)
      .toBe(`${deliveryDestination.slice(0, 8)}…${deliveryDestination.slice(-6)}`);
  });

  it('shares an immediate transport node without treating two-hop paths as local destinations', () => {
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
    expect(graph.edges.find((edge) => edge.to === `destination:${first}`)).toEqual(
      expect.objectContaining({ kind: 'route', hops: 2 }),
    );
    expect(graph.edges.find((edge) => edge.to === `destination:${second}`)).toEqual(
      expect.objectContaining({ kind: 'route', hops: 4 }),
    );
  });

  it('adds an identity node only when a public key owns multiple visible destinations', () => {
    const sharedPublicKey = 'a'.repeat(128);
    const sharedIdentityHash = '1'.repeat(32);
    const singletonPublicKey = 'b'.repeat(128);
    const first = '2'.repeat(32);
    const second = '3'.repeat(32);
    const singleton = '4'.repeat(32);
    const input = {
      interfaces: [websocket],
      interfaceStatuses: {},
      paths: [first, second, singleton].map((destinationHash) => ({
        destinationHash,
        hops: 1,
        interfaceId: websocket.id,
      })),
      destinations: [],
      destinationInventory: [
        { destinationHash: first, publicKey: sharedPublicKey, identityHash: sharedIdentityHash },
        { destinationHash: second, publicKey: sharedPublicKey, identityHash: sharedIdentityHash },
        { destinationHash: singleton, publicKey: singletonPublicKey, identityHash: '5'.repeat(32) },
      ],
      groupByIdentity: true,
    };
    const graph = buildNetworkVisualizerGraph(input);
    const identity = graph.nodes.find((node) => node.kind === 'identity'
      && node.publicKey === sharedPublicKey)!;
    const identityId = identity.id;

    expect(graph.nodes.filter((node) => node.kind === 'identity')).toEqual([
      expect.objectContaining({
        id: identityId,
        publicKey: sharedPublicKey,
        identityHash: sharedIdentityHash,
        label: `${sharedIdentityHash.slice(0, 8)}…${sharedIdentityHash.slice(-6)}`,
        destinationCount: 2,
        expanded: false,
      }),
    ]);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: `interface:${websocket.id}`, to: identityId }),
      expect.objectContaining({ from: `interface:${websocket.id}`, to: `destination:${singleton}` }),
    ]));
    expect(graph.nodes.some((node) => node.destinationHash === first
      || node.destinationHash === second)).toBe(false);
    expect(graph.nodes.some((node) => node.kind === 'identity'
      && node.publicKey === singletonPublicKey)).toBe(false);

    const expanded = buildNetworkVisualizerGraph({
      ...input,
      expandedIdentityPublicKeys: new Set([sharedPublicKey]),
    });
    expect(expanded.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: identityId,
        to: `destination:${first}`,
        kind: 'direct',
        hops: 1,
        showHopLabel: false,
        matched: true,
      }),
      expect.objectContaining({
        from: identityId,
        to: `destination:${second}`,
        kind: 'direct',
        hops: 1,
        showHopLabel: false,
        matched: true,
      }),
      expect.objectContaining({ from: `interface:${websocket.id}`, to: identityId, matched: true }),
    ]));
    expect(expanded.nodes.find((node) => node.id === identityId)).toEqual(expect.objectContaining({
      expanded: true,
      matched: true,
    }));
    expect(expanded.nodes.find((node) => node.id === 'local')?.matched).toBe(true);
    expect(expanded.nodes.find((node) => node.id === `interface:${websocket.id}`)?.matched).toBe(true);
    expect(expanded.nodes.find((node) => node.id === `destination:${first}`)?.matched).toBe(true);
    expect(expanded.nodes.find((node) => node.id === `destination:${second}`)?.matched).toBe(true);
    expect(expanded.nodes.find((node) => node.id === `destination:${singleton}`)?.matched).toBe(false);
    expect(expanded.matchedPathCount).toBe(0);

    const otherPublicKey = '6'.repeat(128);
    const otherFirst = '7'.repeat(32);
    const otherSecond = '8'.repeat(32);
    const expandedWithOtherGroup = buildNetworkVisualizerGraph({
      ...input,
      paths: [
        ...input.paths,
        { destinationHash: otherFirst, hops: 1, interfaceId: websocket.id },
        { destinationHash: otherSecond, hops: 1, interfaceId: websocket.id },
      ],
      destinationInventory: [
        ...input.destinationInventory,
        { destinationHash: otherFirst, publicKey: otherPublicKey, identityHash: '9'.repeat(32) },
        { destinationHash: otherSecond, publicKey: otherPublicKey, identityHash: '9'.repeat(32) },
      ],
      expandedIdentityPublicKeys: new Set([sharedPublicKey]),
    });
    expect(expandedWithOtherGroup.nodes.find((node) => node.id === identityId)?.matched).toBe(true);
    expect(expandedWithOtherGroup.nodes.find((node) => (
      node.kind === 'identity' && node.publicKey === otherPublicKey
    ))?.matched).toBe(false);

    const searched = buildNetworkVisualizerGraph({
      ...input,
      search: singleton,
      expandedIdentityPublicKeys: new Set([sharedPublicKey]),
    });
    expect(searched.nodes.find((node) => node.id === identityId)?.matched).toBe(false);
    expect(searched.nodes.find((node) => node.id === `destination:${singleton}`)?.matched).toBe(true);
    expect(searched.matchedPathCount).toBe(1);

    const expiredGroup = buildNetworkVisualizerGraph({
      ...input,
      paths: input.paths.filter((path) => path.destinationHash !== second),
      expandedIdentityPublicKeys: new Set([sharedPublicKey]),
    });
    expect(expiredGroup.nodes.some((node) => node.kind === 'identity'
      && node.publicKey === sharedPublicKey)).toBe(false);
    expect(expiredGroup.nodes.find((node) => node.id === `destination:${first}`)?.matched).toBe(false);
    expect(expiredGroup.edges.some((edge) => edge.matched)).toBe(false);
  });

  it('projects one synchronized identity occurrence into each ingress interface', () => {
    const secondInterface: InterfaceConfig = {
      ...websocket,
      id: 'websocket-2',
      name: 'Field relay',
    };
    const publicKey = 'a'.repeat(128);
    const identityHash = 'b'.repeat(32);
    const first = 'c'.repeat(32);
    const second = 'd'.repeat(32);
    const input = {
      interfaces: [websocket, secondInterface],
      interfaceStatuses: {},
      paths: [
        { destinationHash: first, hops: 1, interfaceId: websocket.id },
        { destinationHash: second, hops: 1, interfaceId: secondInterface.id },
      ],
      destinations: [],
      destinationInventory: [
        { destinationHash: first, publicKey, identityHash },
        { destinationHash: second, publicKey, identityHash },
      ],
      groupByIdentity: true,
    };
    const collapsed = buildNetworkVisualizerGraph(input);
    const collapsedOccurrences = collapsed.nodes.filter((node) => (
      node.kind === 'identity' && node.publicKey === publicKey
    ));

    expect(collapsedOccurrences).toHaveLength(2);
    expect(collapsedOccurrences.every((node) => (
      node.destinationCount === 2 && node.expanded === false
    ))).toBe(true);
    expect(new Set(collapsedOccurrences.map((node) => node.id)).size).toBe(2);
    expect(collapsed.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: `interface:${websocket.id}`, to: collapsedOccurrences[0].id }),
      expect.objectContaining({ from: `interface:${secondInterface.id}`, to: collapsedOccurrences[1].id }),
    ]));

    const expanded = buildNetworkVisualizerGraph({
      ...input,
      expandedIdentityPublicKeys: new Set([publicKey]),
    });
    const expandedOccurrences = expanded.nodes.filter((node) => (
      node.kind === 'identity' && node.publicKey === publicKey
    ));
    const childEdges = expanded.edges.filter((edge) => (
      expandedOccurrences.some((node) => node.id === edge.from)
      && edge.to.startsWith('destination:')
    ));

    expect(expandedOccurrences).toHaveLength(2);
    expect(expandedOccurrences.every((node) => (
      node.destinationCount === 2 && node.expanded === true && node.matched === true
    ))).toBe(true);
    expect(childEdges).toHaveLength(2);
    expect(new Set(childEdges.map((edge) => edge.to))).toEqual(new Set([
      `destination:${first}`,
      `destination:${second}`,
    ]));
  });

  it('keeps transport and routed identity occurrences role-specific', () => {
    const secondInterface: InterfaceConfig = {
      ...websocket,
      id: 'websocket-2',
      name: 'Field relay',
    };
    const publicKey = 'a'.repeat(128);
    const identityHash = 'b'.repeat(32);
    const routedVia = '1'.repeat(32);
    const routedIdentityDestination = 'c'.repeat(32);
    const relayedDestination = 'd'.repeat(32);
    const transportIdentityDestinations = ['e'.repeat(32), 'f'.repeat(32)];
    const input = {
      interfaces: [websocket, secondInterface],
      interfaceStatuses: {},
      paths: [
        {
          destinationHash: relayedDestination,
          nextHop: identityHash,
          hops: 3,
          interfaceId: websocket.id,
        },
        {
          destinationHash: routedIdentityDestination,
          nextHop: routedVia,
          hops: 2,
          interfaceId: secondInterface.id,
        },
        ...transportIdentityDestinations.map((destinationHash) => ({
          destinationHash,
          hops: 1,
          interfaceId: websocket.id,
        })),
      ],
      destinations: [],
      destinationInventory: [
        routedIdentityDestination,
        ...transportIdentityDestinations,
      ].map((destinationHash) => ({
        destinationHash,
        publicKey,
        identityHash,
      })),
      groupByIdentity: true,
    };
    const collapsed = buildNetworkVisualizerGraph(input);
    const occurrences = collapsed.nodes.filter((node) => (
      node.kind === 'identity' && node.publicKey === publicKey
    ));
    const identityOccurrenceId = collapsed.edges.find((edge) => (
      edge.from === `next-hop:${secondInterface.id}:${routedVia}`
      && occurrences.some((node) => node.id === edge.to)
    ))?.to;
    const transportOccurrence = occurrences.find((node) => node.nextHopHash === identityHash)!;
    const identityOccurrence = occurrences.find((node) => node.id === identityOccurrenceId)!;

    expect(occurrences).toHaveLength(2);
    expect(transportOccurrence).toEqual(expect.objectContaining({
      nextHopHash: identityHash,
    }));
    expect(transportOccurrence.destinationCount).toBeUndefined();
    expect(transportOccurrence.expanded).toBeUndefined();
    expect(identityOccurrence).toEqual(expect.objectContaining({
      destinationCount: 3,
      expanded: false,
    }));
    expect(identityOccurrence.nextHopHash).toBeUndefined();
    expect(collapsed.nodes.some((node) => node.kind === 'nextHop'
      && node.nextHopHash === identityHash)).toBe(false);
    expect(collapsed.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: transportOccurrence.id,
        to: `destination:${relayedDestination}`,
      }),
    ]));
    expect(collapsed.nodes.some((node) => node.destinationHash === relayedDestination)).toBe(true);
    expect(transportIdentityDestinations.every((destinationHash) => (
      collapsed.nodes.some((node) => node.destinationHash === destinationHash)
    ))).toBe(true);
    expect(collapsed.nodes.some((node) => (
      node.destinationHash === routedIdentityDestination
    ))).toBe(false);

    const expanded = buildNetworkVisualizerGraph({
      ...input,
      expandedIdentityPublicKeys: new Set([publicKey]),
    });
    expect(expanded.nodes.find((node) => node.id === identityOccurrence.id))
      .toEqual(expect.objectContaining({
        destinationCount: 3,
        expanded: true,
      }));
    expect(expanded.nodes.find((node) => node.id === identityOccurrence.id)?.nextHopHash)
      .toBeUndefined();
    expect(expanded.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: identityOccurrence.id,
        to: `destination:${routedIdentityDestination}`,
        kind: 'direct',
        hops: 2,
        showHopLabel: false,
      }),
    ]));
  });

  it('renders every direct interface occurrence of a known transport identity as transport', () => {
    const secondInterface: InterfaceConfig = {
      ...websocket,
      id: 'websocket-2',
      name: 'Field relay',
    };
    const publicKey = 'a'.repeat(128);
    const identityHash = 'b'.repeat(32);
    const ownedDestination = 'c'.repeat(32);
    const relayedDestination = 'd'.repeat(32);
    const graph = buildNetworkVisualizerGraph({
      interfaces: [websocket, secondInterface],
      interfaceStatuses: {},
      paths: [
        {
          destinationHash: relayedDestination,
          nextHop: identityHash,
          hops: 3,
          interfaceId: websocket.id,
        },
        {
          destinationHash: ownedDestination,
          hops: 1,
          interfaceId: secondInterface.id,
        },
      ],
      destinations: [],
      destinationInventory: [{ destinationHash: ownedDestination, publicKey, identityHash }],
      groupByIdentity: true,
    });
    const occurrences = graph.nodes.filter((node) => (
      node.kind === 'identity' && node.publicKey === publicKey
    ));

    expect(occurrences).toHaveLength(2);
    expect(occurrences.every((node) => node.nextHopHash === identityHash)).toBe(true);
    expect(occurrences.every((node) => node.destinationCount === undefined)).toBe(true);
    expect(graph.nodes.some((node) => node.destinationHash === ownedDestination)).toBe(true);
  });

  it('leaves a singleton identity destination ungrouped behind another transport', () => {
    const publicKey = 'a'.repeat(128);
    const identityHash = 'b'.repeat(32);
    const otherTransportHash = 'c'.repeat(32);
    const ownedDestination = 'd'.repeat(32);
    const relayedDestination = 'e'.repeat(32);
    const graph = buildNetworkVisualizerGraph({
      interfaces: [websocket],
      interfaceStatuses: {},
      paths: [
        {
          destinationHash: relayedDestination,
          nextHop: identityHash,
          hops: 3,
          interfaceId: websocket.id,
        },
        {
          destinationHash: ownedDestination,
          nextHop: otherTransportHash,
          hops: 2,
          interfaceId: websocket.id,
        },
      ],
      destinations: [],
      destinationInventory: [{ destinationHash: ownedDestination, publicKey, identityHash }],
      groupByIdentity: true,
    });
    const identityOccurrences = graph.nodes.filter((node) => (
      node.kind === 'identity' && node.publicKey === publicKey
    ));

    expect(identityOccurrences).toHaveLength(1);
    expect(identityOccurrences[0].nextHopHash).toBe(identityHash);
    expect(identityOccurrences[0].destinationCount).toBeUndefined();
    expect(graph.nodes.find((node) => node.destinationHash === ownedDestination))
      .toEqual(expect.objectContaining({ kind: 'destination' }));
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        from: `next-hop:${websocket.id}:${otherTransportHash}`,
        to: `destination:${ownedDestination}`,
      }),
    ]));
  });

  it('uses one identity node as both a transport and a local-destination parent', () => {
    const transportPublicKey = 'a'.repeat(128);
    const transportIdentityHash = '6'.repeat(32);
    const downstreamPublicKey = 'b'.repeat(128);
    const downstreamIdentityHash = '7'.repeat(32);
    const transportDestinations = ['8'.repeat(32), '9'.repeat(32)];
    const downstreamDestinations = ['c'.repeat(32), 'd'.repeat(32)];
    const graph = buildNetworkVisualizerGraph({
      interfaces: [websocket],
      interfaceStatuses: {},
      paths: [
        ...transportDestinations.map((destinationHash) => ({
          destinationHash,
          hops: 1,
          interfaceId: websocket.id,
        })),
        ...downstreamDestinations.map((destinationHash) => ({
          destinationHash,
          nextHop: transportIdentityHash,
          hops: 3,
          interfaceId: websocket.id,
        })),
      ],
      destinations: [],
      destinationInventory: [
        ...transportDestinations.map((destinationHash) => ({
          destinationHash,
          publicKey: transportPublicKey,
          identityHash: transportIdentityHash,
        })),
        ...downstreamDestinations.map((destinationHash) => ({
          destinationHash,
          publicKey: downstreamPublicKey,
          identityHash: downstreamIdentityHash,
        })),
      ],
      groupByIdentity: true,
      expandedIdentityPublicKeys: new Set([transportPublicKey, downstreamPublicKey]),
    });
    const transportIdentity = graph.nodes.find((node) => node.kind === 'identity'
      && node.publicKey === transportPublicKey
      && node.nextHopHash === transportIdentityHash)!;
    const downstreamIdentity = graph.nodes.find((node) => node.kind === 'identity'
      && node.publicKey === downstreamPublicKey)!;
    const transportIdentityId = transportIdentity.id;
    const downstreamIdentityId = downstreamIdentity.id;

    expect(transportIdentity).toEqual(expect.objectContaining({
      kind: 'identity',
      nextHopHash: transportIdentityHash,
    }));
    expect(transportIdentity.destinationCount).toBeUndefined();
    expect(transportIdentity.expanded).toBeUndefined();
    expect(graph.nodes.some((node) => node.kind === 'nextHop'
      && node.nextHopHash === transportIdentityHash)).toBe(false);
    expect(graph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({ from: `interface:${websocket.id}`, to: transportIdentityId }),
      expect.objectContaining({ from: transportIdentityId, to: downstreamIdentityId }),
      ...transportDestinations.map((destinationHash) => expect.objectContaining({
        from: transportIdentityId,
        to: `destination:${destinationHash}`,
      })),
      ...downstreamDestinations.map((destinationHash) => expect.objectContaining({
        from: downstreamIdentityId,
        to: `destination:${destinationHash}`,
      })),
    ]));
  });

  it('recursively reserves each grouped identity destination orbit in its parent layout', () => {
    const transportPublicKey = 'a'.repeat(128);
    const transportIdentityHash = 'f'.repeat(32);
    const transportDestinations = [`${'a'.repeat(31)}0`, `${'a'.repeat(31)}1`];
    const groupedIdentities = Array.from({ length: 8 }, (_, index) => {
      const digit = (index + 1).toString(16);
      return {
        publicKey: digit.repeat(128),
        identityHash: digit.repeat(32),
        destinations: [`${digit.repeat(31)}0`, `${digit.repeat(31)}1`],
      };
    });
    const graph = buildNetworkVisualizerGraph({
      interfaces: [websocket],
      interfaceStatuses: {},
      paths: [
        ...transportDestinations.map((destinationHash) => ({
          destinationHash,
          hops: 1,
          interfaceId: websocket.id,
        })),
        ...groupedIdentities.flatMap((group) => group.destinations.map((destinationHash) => ({
          destinationHash,
          nextHop: transportIdentityHash,
          hops: 4,
          interfaceId: websocket.id,
        }))),
      ],
      destinations: [],
      destinationInventory: [
        ...transportDestinations.map((destinationHash) => ({
          destinationHash,
          publicKey: transportPublicKey,
          identityHash: transportIdentityHash,
        })),
        ...groupedIdentities.flatMap((group) => group.destinations.map((destinationHash) => ({
          destinationHash,
          publicKey: group.publicKey,
          identityHash: group.identityHash,
        }))),
      ],
      groupByIdentity: true,
      expandedIdentityPublicKeys: new Set([
        transportPublicKey,
        ...groupedIdentities.map((group) => group.publicKey),
      ]),
    });
    const transportIdentity = graph.nodes.find((node) => (
      node.kind === 'identity'
      && node.publicKey === transportPublicKey
      && node.nextHopHash === transportIdentityHash
    ))!;
    const childIdentityIds = new Set(graph.edges
      .filter((edge) => edge.from === transportIdentity.id && edge.to.startsWith('identity:'))
      .map((edge) => edge.to));
    const childIdentities = graph.nodes.filter((node) => childIdentityIds.has(node.id));
    const destinationOrbitRadius = (identity: (typeof graph.nodes)[number]): number => {
      const destinationIds = new Set(graph.edges
        .filter((edge) => edge.from === identity.id && edge.to.startsWith('destination:'))
        .map((edge) => edge.to));
      return Math.max(...graph.nodes
        .filter((node) => destinationIds.has(node.id))
        .map((node) => Math.hypot(node.x - identity.x, node.y - identity.y)));
    };
    const orbitRadii = new Map(childIdentities.map((identity) => [
      identity.id,
      destinationOrbitRadius(identity),
    ]));
    const parentEdgeLengths = childIdentities.map((identity) => (
      Math.hypot(identity.x - transportIdentity.x, identity.y - transportIdentity.y)
    ));
    const circleClearances = childIdentities.flatMap((identity, index) => (
      childIdentities.slice(index + 1).map((other) => (
        Math.hypot(identity.x - other.x, identity.y - other.y)
        - orbitRadii.get(identity.id)!
        - orbitRadii.get(other.id)!
      ))
    ));

    expect(childIdentities).toHaveLength(groupedIdentities.length);
    expect(new Set(parentEdgeLengths.map(Math.round)).size).toBeGreaterThan(1);
    expect(Math.min(...circleClearances)).toBeGreaterThan(0);
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
