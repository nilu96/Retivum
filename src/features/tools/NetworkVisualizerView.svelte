<script lang="ts">
  import {
    Background,
    BackgroundVariant,
    Controls,
    SvelteFlow,
    type FitViewOptions,
    type NodeTypes,
  } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';
  import { onMount, untrack } from 'svelte';
  import { navigateBack } from '../../app/router';
  import type { InterfaceConfig } from '../../domain/settings';
  import { BrowserSettingsRepository } from '../../infrastructure/database/settings-repository';
  import {
    activeIdentity,
    appPreferences,
    chatContacts,
    destinationPathStatuses,
    interfaceConfigurations,
    interfaceStatuses,
    knownDestinations,
    pathTableReady,
    pathTableEntries,
    remoteDestinationInventory,
    reticulumRuntime,
    runtimeStatus,
  } from '../../infrastructure/reticulum/runtime';
  import { disabledPathRequestDestinationHashes } from '../../infrastructure/reticulum/path-request-operations';
  import { pendingProbeDestinationHashes } from '../../infrastructure/reticulum/probe-operations';
  import { probeTimeoutMsForPath } from '../../infrastructure/reticulum/timeouts';
  import { t, type MessageKey } from '../../i18n';
  import type { ContextMenuOpenMethod } from '../../lib/actions/contextMenuTrigger';
  import { copyText } from '../../lib/clipboard';
  import ConfirmationDialog from '../../lib/components/ConfirmationDialog.svelte';
  import ContextMenu from '../../lib/components/ContextMenu.svelte';
  import Icon from '../../lib/components/Icon.svelte';
  import { showDestinationPathRequestActivity } from '../../lib/notifications/path-request-activity';
  import { showDestinationProbeActivity } from '../../lib/notifications/probe-activity';
  import { toast } from '../../lib/notifications/toasts';
  import {
    buildNetworkFlowElements,
    preserveExpandedIdentityNodePositions,
    preserveIdentityToggleNodePositions,
    preserveNetworkFlowNodePositions,
    type RetivumFlowEdge,
    type RetivumFlowNode,
  } from './network-flow';
  import NetworkFlowNode from './NetworkFlowNode.svelte';
  import NetworkFlowFitControl from './NetworkFlowFitControl.svelte';
  import {
    defaultNetworkVisualizerMaximumHops,
    networkVisualizerGroupByIdentity,
    networkVisualizerMaximumHops,
  } from './network-visualizer-runtime-settings';
  import {
    buildNetworkVisualizerGraph,
    type NetworkVisualizerNode,
  } from './network-visualizer';

  interface DestinationActions {
    destinationHash: string;
    displayName: string;
    fullDestinationName?: string;
    x: number;
    y: number;
    autofocus: boolean;
    guardOpeningRelease: boolean;
  }

  interface InterfaceActions {
    interfaceId: string;
    displayName: string;
    enabled: boolean;
    destinationHashes: string[];
    x: number;
    y: number;
    autofocus: boolean;
    guardOpeningRelease: boolean;
  }

  interface IdentityActions {
    publicKey: string;
    identityHash?: string;
    displayName: string;
    destinationHashes: string[];
    probeSourceHash?: string;
    x: number;
    y: number;
    autofocus: boolean;
    guardOpeningRelease: boolean;
  }

  interface NextHopActions {
    nextHopHash: string;
    displayName: string;
    x: number;
    y: number;
    autofocus: boolean;
    guardOpeningRelease: boolean;
  }

  interface NextHopPathRemoval {
    nextHopHash: string;
    displayName: string;
    destinationHashes: string[];
  }

  interface IdentityPathRemoval {
    publicKey: string;
    displayName: string;
    destinationHashes: string[];
  }

  interface InterfacePathRemoval {
    interfaceId: string;
    displayName: string;
    destinationHashes: string[];
  }

  interface InterfaceRemoval {
    interfaceId: string;
    displayName: string;
  }

  const minimumGraphZoom = .05;
  const identityToggleDurationMs = 240;
  const settingsRepository = new BrowserSettingsRepository();

  let search = $state('');
  let expandedIdentityPublicKeys = $state.raw<ReadonlySet<string>>(new Set());
  let destinationActions = $state<DestinationActions>();
  let identityActions = $state<IdentityActions>();
  let nextHopActions = $state<NextHopActions>();
  let interfaceActions = $state<InterfaceActions>();
  let interfaceRemoval = $state<InterfaceRemoval>();
  let interfacePathRemoval = $state<InterfacePathRemoval>();
  let identityPathRemoval = $state<IdentityPathRemoval>();
  let nextHopPathRemoval = $state<NextHopPathRemoval>();
  let interfaceOperationBusyId = $state<string>();
  let droppingInterfaceId = $state<string>();
  let droppingNextHopHash = $state<string>();
  let droppingIdentityPublicKey = $state<string>();
  let droppingPathHashes = $state<string[]>([]);
  let flowNodes = $state.raw<RetivumFlowNode[]>([]);
  let flowEdges = $state.raw<RetivumFlowEdge[]>([]);
  let compactViewport = $state(false);
  let synchronizedTopologyRevision = '';
  let synchronizedSearch = '';
  let pendingIdentityToggle: { publicKey: string; expanding: boolean } | undefined;
  let pendingIdentityCollapseAll = false;
  let identityAnimationTimer: number | undefined;
  let identityToggleBusy = false;
  let identityCollapseAllInProgress = false;
  let pageElement: HTMLDivElement;
  let pointerGesture: {
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | undefined;
  const manuallyPositionedNodeIds = new Set<string>();

  const nodeTypes: NodeTypes = { network: NetworkFlowNode };
  const fitViewOptions: FitViewOptions<RetivumFlowNode> = $derived({
    padding: compactViewport
      ? { top: '180px', right: '22px', bottom: '66px', left: '22px' }
      : .2,
    minZoom: minimumGraphZoom,
    maxZoom: 1.6,
  });
  const proOptions = { hideAttribution: true };

  onMount(() => {
    const query = window.matchMedia('(max-width: 600px)');
    const update = (): void => { compactViewport = query.matches; };
    update();
    query.addEventListener('change', update);
    window.addEventListener('keydown', handleGlobalKeydown, true);
    pageElement.addEventListener('pointerdown', handlePagePointerDown, true);
    pageElement.addEventListener('pointermove', handlePagePointerMove, true);
    pageElement.addEventListener('click', handlePageClick, true);
    return () => {
      query.removeEventListener('change', update);
      window.removeEventListener('keydown', handleGlobalKeydown, true);
      pageElement.removeEventListener('pointerdown', handlePagePointerDown, true);
      pageElement.removeEventListener('pointermove', handlePagePointerMove, true);
      pageElement.removeEventListener('click', handlePageClick, true);
      stopIdentityAnimation();
    };
  });

  const graph = $derived(buildNetworkVisualizerGraph({
    identity: $activeIdentity,
    interfaces: $interfaceConfigurations,
    interfaceStatuses: $interfaceStatuses,
    paths: $pathTableEntries,
    destinations: $knownDestinations,
    destinationInventory: $remoteDestinationInventory,
    contacts: $chatContacts,
    search,
    maximumHops: $networkVisualizerMaximumHops,
    groupByIdentity: $networkVisualizerGroupByIdentity,
    expandedIdentityPublicKeys,
  }));
  const interfaceCount = $derived(graph.nodes.filter((node) => node.kind === 'interface').length);
  const nextHopCount = $derived(graph.nodes.filter((node) => node.nextHopHash).length);
  const searchActive = $derived(search.trim().length > 0);
  const graphHighlightActive = $derived(
    searchActive || graph.nodes.some((node) => node.kind === 'identity' && node.expanded),
  );
  const routeFilterActive = $derived(
    $networkVisualizerMaximumHops !== undefined
      && $pathTableEntries.some((path) => path.hops > $networkVisualizerMaximumHops!),
  );
  const initialFitReady = $derived($pathTableReady || $runtimeStatus === 'error');
  const layoutRevision = $derived(graph.nodes.map((node) => (
    `${node.id}:${node.x}:${node.y}`
  )).join('|') + `:${compactViewport ? 'compact' : 'wide'}`);
  const topologyRevision = $derived([
    graph.nodes.map((node) => node.id).join('|'),
    graph.edges.map((edge) => `${edge.id}:${edge.from}:${edge.to}`).join('|'),
  ].join('::'));

  const flowAriaLabelConfig = $derived({
    'node.a11yDescription.default': $t('networkVisualizer.flow.nodeDescription'),
    'node.a11yDescription.keyboardDisabled': $t('networkVisualizer.flow.nodeDescription'),
    'edge.a11yDescription.default': $t('networkVisualizer.flow.edgeDescription'),
    'controls.ariaLabel': $t('networkVisualizer.view.label'),
    'controls.zoomIn.ariaLabel': $t('networkVisualizer.view.zoomIn'),
    'controls.zoomOut.ariaLabel': $t('networkVisualizer.view.zoomOut'),
    'controls.fitView.ariaLabel': $t('networkVisualizer.view.fit'),
    'handle.ariaLabel': $t('networkVisualizer.flow.handle'),
  });

  $effect(() => {
    if (expandedIdentityPublicKeys.size === 0) return;
    const expandablePublicKeys = new Set(graph.nodes.flatMap((node) => (
      node.kind === 'identity'
      && node.expanded
      && node.destinationCount !== undefined
      && node.publicKey
        ? [node.publicKey]
        : []
    )));
    const retainedPublicKeys = new Set(Array.from(expandedIdentityPublicKeys).filter((publicKey) => (
      expandablePublicKeys.has(publicKey)
    )));
    if (retainedPublicKeys.size === expandedIdentityPublicKeys.size) return;
    stopIdentityAnimation();
    if (pendingIdentityToggle && !expandablePublicKeys.has(
      pendingIdentityToggle.publicKey,
    )) pendingIdentityToggle = undefined;
    expandedIdentityPublicKeys = retainedPublicKeys;
  });

  $effect(() => {
    const revision = topologyRevision;
    const currentSearch = search;
    const searchChanged = currentSearch !== synchronizedSearch;
    synchronizedSearch = currentSearch;
    if (revision !== synchronizedTopologyRevision) {
      synchronizedTopologyRevision = revision;
      if (searchChanged) {
        syncPresentation();
        return;
      }
      syncTopology();
      return;
    }
    syncPresentation();
  });

  $effect(() => {
    if (destinationActions && !graph.nodes.some((node) => (
      node.destinationHash === destinationActions?.destinationHash
    ))) destinationActions = undefined;
    if (identityActions && !graph.nodes.some((node) => (
      node.kind === 'identity' && node.publicKey === identityActions?.publicKey
    ))) identityActions = undefined;
    if (nextHopActions && !graph.nodes.some((node) => (
      node.nextHopHash === nextHopActions?.nextHopHash
    ))) nextHopActions = undefined;
    if (interfaceActions && !graph.nodes.some((node) => (
      node.interfaceId === interfaceActions?.interfaceId
    ))) interfaceActions = undefined;
  });

  function setSearch(value: string): void {
    search = value;
  }

  function handleGlobalKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') collapseAllIdentityGroups();
  }

  function handlePagePointerDown(event: PointerEvent): void {
    if (event.isPrimary === false || event.button !== 0) return;
    pointerGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  }

  function handlePagePointerMove(event: PointerEvent): void {
    if (!pointerGesture || pointerGesture.pointerId !== event.pointerId) return;
    if (Math.hypot(
      event.clientX - pointerGesture.startX,
      event.clientY - pointerGesture.startY,
    ) >= 5) pointerGesture.moved = true;
  }

  function handlePageClick(event: MouseEvent): void {
    const moved = pointerGesture?.moved ?? false;
    pointerGesture = undefined;
    if (moved) return;
    const target = event.target;
    if (target instanceof Element && target.closest('.network-flow-node.search-match')) return;
    collapseAllIdentityGroups();
  }

  function handleSearchKeydown(event: KeyboardEvent & { currentTarget: HTMLInputElement }): void {
    if (event.key !== 'Escape') return;
    setSearch('');
    event.currentTarget.blur();
  }

  function setMaximumHops(value: string): void {
    const parsed = Number(value);
    networkVisualizerMaximumHops.set(value === '' || !Number.isFinite(parsed)
      ? undefined
      : Math.max(1, Math.min(128, Math.round(parsed))));
  }

  function restoreDefaultMaximumHops(): void {
    if ($networkVisualizerMaximumHops === undefined) {
      networkVisualizerMaximumHops.set(defaultNetworkVisualizerMaximumHops);
    }
  }

  function resetArrangement(): void {
    stopIdentityAnimation();
    manuallyPositionedNodeIds.clear();
    pendingIdentityToggle = undefined;
    pendingIdentityCollapseAll = false;
    expandedIdentityPublicKeys = new Set();
    const elements = buildNetworkFlowElements(graph, {
      ariaLabel: nodeAriaLabel,
      label: clippedLabel,
      onopen: openNodeActions,
      ontoggle: toggleIdentityGroup,
      searchActive: graphHighlightActive,
    });
    flowNodes = elements.nodes;
    flowEdges = elements.edges;
  }

  function syncTopology(): void {
    const elements = buildNetworkFlowElements(graph, {
      ariaLabel: nodeAriaLabel,
      label: clippedLabel,
      onopen: openNodeActions,
      ontoggle: toggleIdentityGroup,
      searchActive: graphHighlightActive,
    });
    const currentNodes = untrack(() => flowNodes);
    const collapseAll = pendingIdentityCollapseAll;
    pendingIdentityCollapseAll = false;
    if (collapseAll) {
      flowNodes = preserveNetworkFlowNodePositions(elements.nodes, currentNodes);
      flowEdges = elements.edges;
      identityToggleBusy = false;
      return;
    }
    const identityToggle = pendingIdentityToggle;
    pendingIdentityToggle = undefined;
    if (identityToggle) {
      const identityIds = identityNodeIdsForPublicKey(identityToggle.publicKey);
      const localizedNodes = preserveIdentityToggleNodePositions(
        elements.nodes,
        currentNodes,
        elements.edges,
        identityIds,
      );
      flowEdges = elements.edges;
      if (identityToggle.expanding) {
        const currentIds = new Set(currentNodes.map((node) => node.id));
        const currentById = new Map(currentNodes.map((node) => [node.id, node]));
        const insertedDestinationIdentityIds = new Map(elements.edges
          .filter((edge) => (
            identityIds.has(edge.source)
            && !currentIds.has(edge.target)
          ))
          .map((edge) => [edge.target, edge.source] as const));
        const animationStart = localizedNodes.map((node) => {
          const identityId = insertedDestinationIdentityIds.get(node.id);
          const identityPosition = identityId ? currentById.get(identityId)?.position : undefined;
          return identityPosition
            ? { ...node, position: { ...identityPosition } }
            : node;
        });
        animateFlowNodePositions(animationStart, localizedNodes, () => {
          identityToggleBusy = false;
        });
      } else {
        flowNodes = localizedNodes;
        identityToggleBusy = false;
      }
      return;
    }
    const expandedIdentityNodeIds = new Set(graph.nodes
      .filter((node) => (
        node.kind === 'identity'
        && node.destinationCount !== undefined
        && Boolean(node.publicKey && expandedIdentityPublicKeys.has(node.publicKey))
      ))
      .map((node) => node.id));
    flowNodes = preserveExpandedIdentityNodePositions(
      elements.nodes,
      currentNodes,
      elements.edges,
      expandedIdentityNodeIds,
      manuallyPositionedNodeIds,
    );
    flowEdges = elements.edges;
    const retainedIds = new Set(flowNodes.map((node) => node.id));
    for (const nodeId of manuallyPositionedNodeIds) {
      if (!retainedIds.has(nodeId)) manuallyPositionedNodeIds.delete(nodeId);
    }
  }

  function cancelIdentityAnimationTimer(): void {
    if (identityAnimationTimer === undefined) return;
    window.clearTimeout(identityAnimationTimer);
    identityAnimationTimer = undefined;
  }

  function stopIdentityAnimation(): void {
    cancelIdentityAnimationTimer();
    identityToggleBusy = false;
    identityCollapseAllInProgress = false;
  }

  function animateFlowNodePositions(
    startNodes: readonly RetivumFlowNode[],
    targetNodes: readonly RetivumFlowNode[],
    oncomplete: () => void,
  ): void {
    cancelIdentityAnimationTimer();
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion || identityToggleDurationMs <= 0) {
      flowNodes = [...targetNodes];
      oncomplete();
      return;
    }
    const startPositions = new Map(startNodes.map((node) => [node.id, node.position]));
    flowNodes = [...startNodes];
    const frameIntervalMs = 16;
    let elapsedMs = 0;
    const step = (): void => {
      elapsedMs += frameIntervalMs;
      const progress = Math.min(1, elapsedMs / identityToggleDurationMs);
      const eased = 1 - (1 - progress) ** 3;
      flowNodes = targetNodes.map((node) => {
        const start = startPositions.get(node.id) ?? node.position;
        return {
          ...node,
          position: {
            x: start.x + (node.position.x - start.x) * eased,
            y: start.y + (node.position.y - start.y) * eased,
          },
        };
      });
      if (progress < 1) {
        identityAnimationTimer = window.setTimeout(step, frameIntervalMs);
        return;
      }
      identityAnimationTimer = undefined;
      flowNodes = [...targetNodes];
      oncomplete();
    };
    identityAnimationTimer = window.setTimeout(step, frameIntervalMs);
  }

  function identityNodeIdsForPublicKey(publicKey: string): Set<string> {
    return new Set(graph.nodes
      .filter((node) => (
        node.kind === 'identity'
        && node.destinationCount !== undefined
        && node.publicKey === publicKey
      ))
      .map((node) => node.id));
  }

  function animateIdentityCollapse(publicKey: string, oncomplete: () => void): void {
    const currentNodes = untrack(() => flowNodes);
    const currentEdges = untrack(() => flowEdges);
    const identityIds = identityNodeIdsForPublicKey(publicKey);
    if (identityIds.size === 0) {
      oncomplete();
      return;
    }
    const nodesById = new Map(currentNodes.map((entry) => [entry.id, entry]));
    const childIdentityIds = new Map<string, string>();
    const identityAnimationZIndexes = new Map<string, number>();
    for (const edge of currentEdges) {
      if (!identityIds.has(edge.source) || nodesById.get(edge.target)?.data.kind !== 'destination') continue;
      childIdentityIds.set(edge.target, edge.source);
      identityAnimationZIndexes.set(edge.source, Math.max(
        identityAnimationZIndexes.get(edge.source) ?? nodesById.get(edge.source)?.zIndex ?? 0,
        (nodesById.get(edge.target)?.zIndex ?? 0) + 1,
      ));
    }
    const collapseStartNodes = currentNodes.map((entry) => {
      const zIndex = identityAnimationZIndexes.get(entry.id);
      return zIndex === undefined ? entry : { ...entry, zIndex };
    });
    const collapsedNodes = collapseStartNodes.map((entry) => {
      const identityId = childIdentityIds.get(entry.id);
      const identity = identityId ? nodesById.get(identityId) : undefined;
      return identity ? { ...entry, position: { ...identity.position } } : entry;
    });
    animateFlowNodePositions(collapseStartNodes, collapsedNodes, oncomplete);
  }

  function collapseAllIdentityGroups(): void {
    if (expandedIdentityPublicKeys.size === 0 || identityCollapseAllInProgress) return;
    const identityIds = new Set(graph.nodes
      .filter((node) => (
        node.kind === 'identity'
        && node.destinationCount !== undefined
        && Boolean(node.publicKey && expandedIdentityPublicKeys.has(node.publicKey))
      ))
      .map((node) => node.id));
    const currentNodes = untrack(() => flowNodes);
    const currentEdges = untrack(() => flowEdges);
    const nodesById = new Map(currentNodes.map((node) => [node.id, node]));
    const childIdentityIds = new Map<string, string>();
    const identityAnimationZIndexes = new Map<string, number>();
    for (const edge of currentEdges) {
      if (!identityIds.has(edge.source) || nodesById.get(edge.target)?.data.kind !== 'destination') continue;
      childIdentityIds.set(edge.target, edge.source);
      identityAnimationZIndexes.set(edge.source, Math.max(
        identityAnimationZIndexes.get(edge.source) ?? nodesById.get(edge.source)?.zIndex ?? 0,
        (nodesById.get(edge.target)?.zIndex ?? 0) + 1,
      ));
    }
    const finish = (): void => {
      identityCollapseAllInProgress = false;
      pendingIdentityToggle = undefined;
      pendingIdentityCollapseAll = true;
      expandedIdentityPublicKeys = new Set();
    };
    if (childIdentityIds.size === 0) {
      finish();
      return;
    }
    identityCollapseAllInProgress = true;
    identityToggleBusy = true;
    const collapseStartNodes = currentNodes.map((node) => {
      const zIndex = identityAnimationZIndexes.get(node.id);
      return zIndex === undefined ? node : { ...node, zIndex };
    });
    const collapsedNodes = collapseStartNodes.map((node) => {
      const identityId = childIdentityIds.get(node.id);
      const identity = identityId ? nodesById.get(identityId) : undefined;
      return identity ? { ...node, position: { ...identity.position } } : node;
    });
    animateFlowNodePositions(collapseStartNodes, collapsedNodes, finish);
  }

  function rememberManualNodePositions(nodes: readonly RetivumFlowNode[]): void {
    for (const node of nodes) manuallyPositionedNodeIds.add(node.id);
  }

  function syncPresentation(): void {
    const elements = buildNetworkFlowElements(graph, {
      ariaLabel: nodeAriaLabel,
      label: clippedLabel,
      onopen: openNodeActions,
      ontoggle: toggleIdentityGroup,
      searchActive: graphHighlightActive,
    });
    const currentNodes = untrack(() => flowNodes);
    flowNodes = preserveNetworkFlowNodePositions(elements.nodes, currentNodes);
    flowEdges = elements.edges;
  }

  function nodeLabel(node: NetworkVisualizerNode): string {
    if (node.kind === 'local' && !node.label) return $t('networkVisualizer.node.local');
    if (node.kind === 'interface' && !node.interfaceId) return $t('networkVisualizer.node.unknownInterface');
    return node.label;
  }

  function clippedLabel(node: NetworkVisualizerNode): string {
    const label = nodeLabel(node);
    const maximumLength = node.kind === 'local' ? 22 : 18;
    return label.length > maximumLength ? `${label.slice(0, maximumLength - 1).trimEnd()}…` : label;
  }

  function nodeKindLabel(node: NetworkVisualizerNode): string {
    return $t(`networkVisualizer.node.${node.kind}` as MessageKey);
  }

  function nodeAriaLabel(node: NetworkVisualizerNode): string {
    if (node.kind === 'destination') {
      return $t('networkVisualizer.node.destinationAria', { name: nodeLabel(node) });
    }
    if (node.kind === 'nextHop') {
      return $t('networkVisualizer.node.nextHopAria', { name: nodeLabel(node) });
    }
    if (node.kind === 'identity') {
      if (node.destinationCount !== undefined) {
        return $t('networkVisualizer.node.identityGroupAria', {
          name: nodeLabel(node),
          count: node.destinationCount,
          state: $t(node.expanded
            ? 'networkVisualizer.node.groupExpanded'
            : 'networkVisualizer.node.groupCollapsed'),
        });
      }
      return $t(node.nextHopHash
        ? 'networkVisualizer.node.identityTransportAria'
        : 'networkVisualizer.node.identityAria', { name: nodeLabel(node) });
    }
    if (node.kind === 'interface' && node.interfaceId) {
      return $t('networkVisualizer.node.interfaceAria', { name: nodeLabel(node) });
    }
    return $t('networkVisualizer.node.aria', {
      type: nodeKindLabel(node),
      name: nodeLabel(node),
    });
  }

  function setGroupByIdentity(enabled: boolean): void {
    stopIdentityAnimation();
    manuallyPositionedNodeIds.clear();
    pendingIdentityCollapseAll = false;
    expandedIdentityPublicKeys = new Set();
    networkVisualizerGroupByIdentity.set(enabled);
  }

  function toggleIdentityGroup(node: NetworkVisualizerNode): void {
    if (node.kind !== 'identity'
      || !node.publicKey
      || node.destinationCount === undefined) return;
    if (identityCollapseAllInProgress) {
      stopIdentityAnimation();
      pendingIdentityCollapseAll = false;
      expandedIdentityPublicKeys = new Set();
    }
    if (identityToggleBusy) stopIdentityAnimation();
    const expanded = new Set(expandedIdentityPublicKeys);
    identityToggleBusy = true;
    if (expanded.has(node.publicKey)) {
      animateIdentityCollapse(node.publicKey, () => {
        expanded.delete(node.publicKey!);
        pendingIdentityToggle = { publicKey: node.publicKey!, expanding: false };
        expandedIdentityPublicKeys = expanded;
      });
      return;
    }
    expanded.add(node.publicKey);
    pendingIdentityToggle = { publicKey: node.publicKey, expanding: true };
    expandedIdentityPublicKeys = expanded;
  }

  function openNodeActions(
    node: NetworkVisualizerNode,
    clientX: number,
    clientY: number,
    method: ContextMenuOpenMethod,
  ): void {
    if (node.kind === 'identity' && node.publicKey && !node.nextHopHash) {
      const destinationHashSet = new Set($remoteDestinationInventory
        .filter((entry) => entry.publicKey === node.publicKey)
        .map((entry) => entry.destinationHash));
      const destinationHashes = Array.from(new Set($pathTableEntries
        .filter((entry) => destinationHashSet.has(entry.destinationHash))
        .map((entry) => entry.destinationHash)));
      destinationActions = undefined;
      nextHopActions = undefined;
      interfaceActions = undefined;
      identityActions = {
        publicKey: node.publicKey,
        identityHash: node.identityHash,
        displayName: nodeLabel(node),
        destinationHashes,
        probeSourceHash: node.identityHash ?? destinationHashes[0],
        x: clientX,
        y: clientY,
        autofocus: method === 'keyboard',
        guardOpeningRelease: method === 'longpress',
      };
      return;
    }
    if (node.destinationHash) {
      identityActions = undefined;
      interfaceActions = undefined;
      nextHopActions = undefined;
      destinationActions = {
        destinationHash: node.destinationHash,
        displayName: nodeLabel(node),
        fullDestinationName: node.fullDestinationName,
        x: clientX,
        y: clientY,
        autofocus: method === 'keyboard',
        guardOpeningRelease: method === 'longpress',
      };
      return;
    }
    if (node.nextHopHash) {
      destinationActions = undefined;
      identityActions = undefined;
      interfaceActions = undefined;
      nextHopActions = {
        nextHopHash: node.nextHopHash,
        displayName: nodeLabel(node),
        x: clientX,
        y: clientY,
        autofocus: method === 'keyboard',
        guardOpeningRelease: method === 'longpress',
      };
      return;
    }
    if (!node.interfaceId) return;
    const config = $interfaceConfigurations.find((entry) => entry.id === node.interfaceId);
    if (!config) return;
    destinationActions = undefined;
    identityActions = undefined;
    nextHopActions = undefined;
    interfaceActions = {
      interfaceId: config.id,
      displayName: config.name,
      enabled: config.enabled,
      destinationHashes: Array.from(new Set($pathTableEntries
        .filter((entry) => entry.interfaceId === config.id)
        .map((entry) => entry.destinationHash))),
      x: clientX,
      y: clientY,
      autofocus: method === 'keyboard',
      guardOpeningRelease: method === 'longpress',
    };
  }

  async function copyDestinationHash(destinationHash: string): Promise<void> {
    destinationActions = undefined;
    if (await copyText(destinationHash)) toast.success('common.copied');
    else toast.error('common.copyFailed');
  }

  async function copyTransportIdentityHash(nextHopHash: string): Promise<void> {
    nextHopActions = undefined;
    if (await copyText(nextHopHash)) toast.success('common.copied');
    else toast.error('common.copyFailed');
  }

  async function copyIdentityHash(identityHash: string): Promise<void> {
    identityActions = undefined;
    if (await copyText(identityHash)) toast.success('common.copied');
    else toast.error('common.copyFailed');
  }

  function probeDestination(actions: DestinationActions): void {
    if (!actions.fullDestinationName) return;
    destinationActions = undefined;
    showDestinationProbeActivity({
      destinationHash: actions.destinationHash,
      displayName: actions.displayName,
      fullDestinationName: actions.fullDestinationName,
      timeoutMs: probeTimeoutMsForPath($destinationPathStatuses[actions.destinationHash]),
    });
  }

  function probeNextHop(actions: NextHopActions): void {
    nextHopActions = undefined;
    showDestinationProbeActivity({
      destinationHash: actions.nextHopHash,
      displayName: actions.displayName,
      fullDestinationName: 'rnstransport.probe',
      timeoutMs: probeTimeoutMsForPath(),
    });
  }

  function probeIdentity(actions: IdentityActions): void {
    if (!actions.probeSourceHash) return;
    identityActions = undefined;
    showDestinationProbeActivity({
      destinationHash: actions.probeSourceHash,
      displayName: actions.displayName,
      fullDestinationName: 'rnstransport.probe',
      timeoutMs: probeTimeoutMsForPath(),
    });
  }

  function requestNewPath(destinationHash: string): void {
    destinationActions = undefined;
    const request = showDestinationPathRequestActivity(destinationHash);
    if (request) void request.result;
  }

  async function dropPath(destinationHash: string): Promise<void> {
    if (droppingPathHashes.includes(destinationHash)) return;
    destinationActions = undefined;
    droppingPathHashes = [...droppingPathHashes, destinationHash];
    try {
      const ok = await reticulumRuntime.dropDestinationPath(destinationHash);
      toast[ok ? 'success' : 'error'](ok
        ? 'pathManagement.path.deleted'
        : 'pathManagement.path.deleteFailed');
    } catch {
      toast.error('pathManagement.path.deleteFailed');
    } finally {
      droppingPathHashes = droppingPathHashes.filter((hash) => hash !== destinationHash);
    }
  }

  function requestNextHopPathRemoval(actions: NextHopActions): void {
    const destinationHashes = Array.from(new Set($pathTableEntries
      .filter((entry) => entry.nextHop === actions.nextHopHash)
      .map((entry) => entry.destinationHash)));
    nextHopActions = undefined;
    if (!destinationHashes.length) return;
    nextHopPathRemoval = {
      nextHopHash: actions.nextHopHash,
      displayName: actions.displayName,
      destinationHashes,
    };
  }

  function requestIdentityPathRemoval(actions: IdentityActions): void {
    identityActions = undefined;
    if (!actions.destinationHashes.length) return;
    identityPathRemoval = {
      publicKey: actions.publicKey,
      displayName: actions.displayName,
      destinationHashes: actions.destinationHashes,
    };
  }

  async function dropIdentityPaths(removal: IdentityPathRemoval): Promise<void> {
    if (droppingIdentityPublicKey) return;
    droppingIdentityPublicKey = removal.publicKey;
    droppingPathHashes = Array.from(new Set([
      ...droppingPathHashes,
      ...removal.destinationHashes,
    ]));
    let dropped = 0;
    try {
      const result = await reticulumRuntime.dropDestinationPaths(removal.destinationHashes);
      dropped = result.count;
      if (result.ok && dropped === removal.destinationHashes.length) {
        toast.success('networkVisualizer.identityDrop.success', { count: dropped });
      } else if (dropped > 0) {
        toast.error('networkVisualizer.identityDrop.partial', {
          dropped,
          count: removal.destinationHashes.length,
        });
      } else {
        toast.error('networkVisualizer.identityDrop.failed');
      }
    } catch {
      toast.error('networkVisualizer.identityDrop.failed');
    } finally {
      const completed = new Set(removal.destinationHashes);
      droppingPathHashes = droppingPathHashes.filter((hash) => !completed.has(hash));
      droppingIdentityPublicKey = undefined;
      identityPathRemoval = undefined;
    }
  }

  function requestInterfacePathRemoval(actions: InterfaceActions): void {
    interfaceActions = undefined;
    if (!actions.destinationHashes.length) return;
    interfacePathRemoval = {
      interfaceId: actions.interfaceId,
      displayName: actions.displayName,
      destinationHashes: actions.destinationHashes,
    };
  }

  async function dropInterfacePaths(removal: InterfacePathRemoval): Promise<void> {
    if (droppingInterfaceId) return;
    droppingInterfaceId = removal.interfaceId;
    droppingPathHashes = Array.from(new Set([
      ...droppingPathHashes,
      ...removal.destinationHashes,
    ]));
    let dropped = 0;
    try {
      const result = await reticulumRuntime.dropDestinationPaths(removal.destinationHashes);
      dropped = result.count;
      if (result.ok && dropped === removal.destinationHashes.length) {
        toast.success('networkVisualizer.interfaceDrop.success', { count: dropped });
      } else if (dropped > 0) {
        toast.error('networkVisualizer.interfaceDrop.partial', {
          dropped,
          count: removal.destinationHashes.length,
        });
      } else {
        toast.error('networkVisualizer.interfaceDrop.failed');
      }
    } catch {
      toast.error('networkVisualizer.interfaceDrop.failed');
    } finally {
      const completed = new Set(removal.destinationHashes);
      droppingPathHashes = droppingPathHashes.filter((hash) => !completed.has(hash));
      droppingInterfaceId = undefined;
      interfacePathRemoval = undefined;
    }
  }

  async function dropPathsViaNextHop(removal: NextHopPathRemoval): Promise<void> {
    if (droppingNextHopHash) return;
    droppingNextHopHash = removal.nextHopHash;
    droppingPathHashes = Array.from(new Set([
      ...droppingPathHashes,
      ...removal.destinationHashes,
    ]));
    let dropped = 0;
    try {
      const result = await reticulumRuntime.dropDestinationPaths(removal.destinationHashes);
      dropped = result.count;
      if (result.ok && dropped === removal.destinationHashes.length) {
        toast.success('networkVisualizer.nextHopDrop.success', { count: dropped });
      } else if (dropped > 0) {
        toast.error('networkVisualizer.nextHopDrop.partial', {
          dropped,
          count: removal.destinationHashes.length,
        });
      } else {
        toast.error('networkVisualizer.nextHopDrop.failed');
      }
    } finally {
      const completed = new Set(removal.destinationHashes);
      droppingPathHashes = droppingPathHashes.filter((hash) => !completed.has(hash));
      droppingNextHopHash = undefined;
      nextHopPathRemoval = undefined;
    }
  }

  function hasEnabledBleDeviceConflict(config: InterfaceConfig): boolean {
    return config.enabled
      && config.type === 'rnode'
      && config.connection.type === 'ble'
      && config.connection.deviceId !== undefined
      && $interfaceConfigurations.some((entry) => (
        entry.id !== config.id
        && entry.enabled
        && entry.type === 'rnode'
        && entry.connection.type === 'ble'
        && entry.connection.deviceId === config.connection.deviceId
      ));
  }

  async function toggleInterface(actions: InterfaceActions): Promise<void> {
    if (interfaceOperationBusyId) return;
    const config = $interfaceConfigurations.find((entry) => entry.id === actions.interfaceId);
    if (!config) return;
    interfaceActions = undefined;
    const updated: InterfaceConfig = { ...structuredClone(config), enabled: !config.enabled };
    if (hasEnabledBleDeviceConflict(updated)) {
      toast.error('settings.interfaces.rnodeDeviceInUse');
      return;
    }
    interfaceOperationBusyId = config.id;
    try {
      await settingsRepository.saveInterface(updated);
      const interfaces = $interfaceConfigurations.map((entry) => entry.id === updated.id ? updated : entry);
      interfaceStatuses.update((statuses) => ({
        ...statuses,
        [updated.id]: updated.enabled ? 'connecting' : 'disabled',
      }));
      await reticulumRuntime.applyConfiguration($appPreferences, interfaces);
    } catch {
      toast.error('settings.interfaces.saveError');
    } finally {
      interfaceOperationBusyId = undefined;
    }
  }

  function requestInterfaceRemoval(actions: InterfaceActions): void {
    interfaceActions = undefined;
    interfaceRemoval = {
      interfaceId: actions.interfaceId,
      displayName: actions.displayName,
    };
  }

  async function removeInterface(removal: InterfaceRemoval): Promise<void> {
    if (interfaceOperationBusyId) return;
    interfaceOperationBusyId = removal.interfaceId;
    try {
      await settingsRepository.deleteInterface(removal.interfaceId);
      await reticulumRuntime.applyConfiguration(
        $appPreferences,
        $interfaceConfigurations.filter((entry) => entry.id !== removal.interfaceId),
      );
    } catch {
      toast.error('settings.interfaces.saveError');
    } finally {
      interfaceOperationBusyId = undefined;
      interfaceRemoval = undefined;
    }
  }
</script>

<div class="page network-visualizer-page" bind:this={pageElement}>
  <header class="network-visualizer-header">
    <button class="button secondary compact network-visualizer-back" type="button" onclick={() => navigateBack('tools')}>
      <Icon name="arrow-left" size={16} /><span>{$t('networkVisualizer.backToTools')}</span>
    </button>
    <div class="network-visualizer-header-copy">
      <h1>{$t('networkVisualizer.title')}</h1>
      <p>{$t('networkVisualizer.description')}</p>
    </div>
  </header>
  <section class="network-visualizer-panel" aria-label={$t('networkVisualizer.canvas.label')}>
    <div class="network-visualizer-topbar">
      <section class="network-visualizer-toolbar" aria-label={$t('networkVisualizer.controls.label')}>
        <div class="search-field network-visualizer-search">
          <Icon name="search" size={18} />
          <label class="sr-only" for="network-visualizer-search">{$t('networkVisualizer.search.label')}</label>
          <input
            id="network-visualizer-search"
            value={search}
            placeholder={$t('networkVisualizer.search.placeholder')}
            oninput={(event) => setSearch(event.currentTarget.value)}
            onkeydown={handleSearchKeydown}
          />
          {#if search}
            <button type="button" aria-label={$t('networkVisualizer.search.clear')} onclick={() => setSearch('')}>
              <Icon name="close" size={15} />
            </button>
          {/if}
        </div>
        <label class="network-visualizer-hop-filter">
          <span>{$t('networkVisualizer.maximumHops')}</span>
          <input
            type="number"
            min="1"
            max="128"
            step="1"
            inputmode="numeric"
            value={$networkVisualizerMaximumHops ?? ''}
            oninput={(event) => setMaximumHops(event.currentTarget.value)}
            onblur={restoreDefaultMaximumHops}
          />
        </label>
        <label class="network-visualizer-identity-filter">
          <input
            type="checkbox"
            checked={$networkVisualizerGroupByIdentity}
            onchange={(event) => setGroupByIdentity(event.currentTarget.checked)}
            aria-label={$t('networkVisualizer.groupByIdentity')}
          />
          <span>{$t('networkVisualizer.groupByIdentity')}</span>
        </label>
      </section>
    </div>
    <div class="network-visualizer-legend" aria-label={$t('networkVisualizer.legend.label')}>
      <span>
        <i class="local" aria-hidden="true"><Icon name="identity" size={12} /></i>
        <span class="legend-label">{$t('networkVisualizer.node.identity')}</span>
      </span>
      <span>
        <i class="interface" aria-hidden="true"><Icon name="interface" size={12} /></i>
        <span class="legend-label">{$t('networkVisualizer.node.interface')}</span>
      </span>
      <span>
        <i class="next-hop" aria-hidden="true"><Icon name="route" size={12} /></i>
        <span class="legend-label">{$t('networkVisualizer.node.nextHop')}</span>
      </span>
      <span>
        <i class="destination" aria-hidden="true"><Icon name="identity" size={12} /></i>
        <span class="legend-label">{$t('networkVisualizer.node.destination')}</span>
      </span>
    </div>
    {#if graph.pathCount === 0}
      <div class="network-visualizer-empty" role="status">
        <strong>{$t(routeFilterActive
          ? 'networkVisualizer.empty.filtered.title'
          : 'networkVisualizer.empty.title')}</strong>
        <span>{$t(routeFilterActive
          ? 'networkVisualizer.empty.filtered.body'
          : 'networkVisualizer.empty.body')}</span>
      </div>
    {/if}
    <SvelteFlow
      bind:nodes={flowNodes}
      edges={flowEdges}
      {nodeTypes}
      {fitViewOptions}
      minZoom={minimumGraphZoom}
      maxZoom={2.5}
      zIndexMode="manual"
      nodesDraggable
      nodesConnectable={false}
      elementsSelectable={false}
      nodesFocusable={false}
      edgesFocusable={false}
      disableKeyboardA11y
      zoomOnScroll
      zoomOnPinch
      zoomOnDoubleClick={false}
      panOnDrag
      panOnScroll={false}
      preventScrolling
      onnodedragstop={({ nodes }) => rememberManualNodePositions(nodes)}
      {proOptions}
      ariaLabelConfig={flowAriaLabelConfig}
      class="network-visualizer-flow"
      aria-label={$t('networkVisualizer.canvas.description', {
        routes: graph.pathCount,
        interfaces: interfaceCount,
      })}
    >
      <Background
        id="network-visualizer-dots"
        variant={BackgroundVariant.Dots}
        gap={32}
        size={1.15}
        patternColor="var(--border)"
      />
      <Controls
        class="network-flow-controls"
        position="top-right"
        orientation="vertical"
        showFitView={false}
        showLock={false}
        fitViewOptions={fitViewOptions}
      >
        <NetworkFlowFitControl
          label={$t('networkVisualizer.view.fit')}
          {fitViewOptions}
          {initialFitReady}
          {layoutRevision}
          pathCount={graph.pathCount}
          onarrange={resetArrangement}
        />
      </Controls>
    </SvelteFlow>
    <div class="network-visualizer-bottom-bar">
      <section class="network-visualizer-summary" aria-label={$t('networkVisualizer.summary.label')}>
        <div class="network-visualizer-summary-counts">
          <div><strong>{graph.pathCount}</strong><span>{$t('networkVisualizer.summary.routes')}</span></div>
          {#if searchActive}
            <div class="matches"><strong>{graph.matchedPathCount}</strong><span>{$t(graph.matchedPathCount === 1
              ? 'networkVisualizer.summary.matches.one'
              : 'networkVisualizer.summary.matches.other')}</span></div>
          {/if}
          <div><strong>{interfaceCount}</strong><span>{$t('networkVisualizer.summary.interfaces')}</span></div>
          <div><strong>{nextHopCount}</strong><span>{$t('networkVisualizer.summary.nextHops')}</span></div>
        </div>
        {#if graph.hiddenPathCount > 0}
          <p>{$t('networkVisualizer.summary.omitted', { count: graph.hiddenPathCount })}</p>
        {/if}
      </section>
    </div>
  </section>
</div>

{#if identityActions}
  {@const actions = identityActions}
  <ContextMenu
    x={actions.x}
    y={actions.y}
    autofocus={actions.autofocus}
    guardOpeningRelease={actions.guardOpeningRelease}
    label={$t('networkVisualizer.identityContextMenu.label')}
    closeLabel={$t('networkVisualizer.identityContextMenu.close')}
    onclose={() => { identityActions = undefined; }}
  >
    <button
      role="menuitem"
      disabled={!actions.identityHash}
      onclick={() => { if (actions.identityHash) void copyIdentityHash(actions.identityHash); }}
    >
      <Icon name="copy" size={17} />{$t('networkVisualizer.identityContextMenu.copyHash')}
    </button>
    <button
      role="menuitem"
      disabled={$runtimeStatus !== 'online'
        || !actions.probeSourceHash
        || $pendingProbeDestinationHashes.has(actions.probeSourceHash)}
      onclick={() => { probeIdentity(actions); }}
    >
      <Icon name="probe" size={17} />{$t('networkVisualizer.identityContextMenu.probe')}
    </button>
    <button
      class="danger"
      role="menuitem"
      disabled={!actions.destinationHashes.length || droppingIdentityPublicKey !== undefined}
      onclick={() => { requestIdentityPathRemoval(actions); }}
    >
      <Icon name="route-off" size={17} />{$t('networkVisualizer.identityContextMenu.dropPaths')}
    </button>
  </ContextMenu>
{/if}

{#if destinationActions}
  {@const actions = destinationActions}
  <ContextMenu
    x={actions.x}
    y={actions.y}
    autofocus={actions.autofocus}
    guardOpeningRelease={actions.guardOpeningRelease}
    label={$t('networkVisualizer.contextMenu.label')}
    closeLabel={$t('networkVisualizer.contextMenu.close')}
    onclose={() => { destinationActions = undefined; }}
  >
    <button
      role="menuitem"
      onclick={() => { void copyDestinationHash(actions.destinationHash); }}
    >
      <Icon name="copy" size={17} />{$t('chat.destination.actions.copyHash')}
    </button>
    <button
      role="menuitem"
      disabled={!actions.fullDestinationName
        || $pendingProbeDestinationHashes.has(actions.destinationHash)}
      onclick={() => { probeDestination(actions); }}
    >
      <Icon name="probe" size={17} />{$t('chat.destination.actions.probe')}
    </button>
    <button
      role="menuitem"
      disabled={$runtimeStatus !== 'online'
        || $disabledPathRequestDestinationHashes.has(actions.destinationHash)}
      onclick={() => { requestNewPath(actions.destinationHash); }}
    >
      <Icon name="route" size={17} />{$t('pathManagement.entry.request')}
    </button>
    <button
      class="danger"
      role="menuitem"
      disabled={droppingPathHashes.includes(actions.destinationHash)}
      onclick={() => { void dropPath(actions.destinationHash); }}
    >
      <Icon name="route-off" size={17} />{$t('networkVisualizer.contextMenu.dropPath')}
    </button>
  </ContextMenu>
{/if}

{#if nextHopActions}
  {@const actions = nextHopActions}
  <ContextMenu
    x={actions.x}
    y={actions.y}
    autofocus={actions.autofocus}
    guardOpeningRelease={actions.guardOpeningRelease}
    label={$t('networkVisualizer.nextHopContextMenu.label')}
    closeLabel={$t('networkVisualizer.nextHopContextMenu.close')}
    onclose={() => { nextHopActions = undefined; }}
  >
    <button
      role="menuitem"
      onclick={() => { void copyTransportIdentityHash(actions.nextHopHash); }}
    >
      <Icon name="copy" size={17} />{$t('networkVisualizer.nextHopContextMenu.copyIdentityHash')}
    </button>
    <button
      role="menuitem"
      disabled={$runtimeStatus !== 'online'
        || $pendingProbeDestinationHashes.has(actions.nextHopHash)}
      onclick={() => { probeNextHop(actions); }}
    >
      <Icon name="probe" size={17} />{$t('networkVisualizer.nextHopContextMenu.probe')}
    </button>
    <button
      class="danger"
      role="menuitem"
      disabled={droppingNextHopHash !== undefined}
      onclick={() => { requestNextHopPathRemoval(actions); }}
    >
      <Icon name="route-off" size={17} />{$t('networkVisualizer.nextHopContextMenu.dropPaths')}
    </button>
  </ContextMenu>
{/if}

{#if interfaceActions}
  {@const actions = interfaceActions}
  <ContextMenu
    x={actions.x}
    y={actions.y}
    autofocus={actions.autofocus}
    guardOpeningRelease={actions.guardOpeningRelease}
    label={$t('networkVisualizer.interfaceContextMenu.label')}
    closeLabel={$t('networkVisualizer.interfaceContextMenu.close')}
    onclose={() => { interfaceActions = undefined; }}
  >
    <button
      role="menuitem"
      disabled={interfaceOperationBusyId !== undefined || droppingInterfaceId !== undefined}
      onclick={() => { void toggleInterface(actions); }}
    >
      <Icon name={actions.enabled ? 'block' : 'check'} size={17} />
      {$t(actions.enabled ? 'settings.interfaces.disable' : 'settings.interfaces.enable')}
    </button>
    <button
      class="danger"
      role="menuitem"
      disabled={!actions.destinationHashes.length
        || droppingInterfaceId !== undefined
        || interfaceOperationBusyId !== undefined}
      onclick={() => { requestInterfacePathRemoval(actions); }}
    >
      <Icon name="route-off" size={17} />{$t('networkVisualizer.interfaceContextMenu.dropPaths')}
    </button>
    <button
      class="danger"
      role="menuitem"
      disabled={interfaceOperationBusyId !== undefined || droppingInterfaceId !== undefined}
      onclick={() => { requestInterfaceRemoval(actions); }}
    >
      <Icon name="trash" size={17} />{$t('networkVisualizer.interfaceContextMenu.remove')}
    </button>
  </ContextMenu>
{/if}

{#if interfacePathRemoval}
  {@const removal = interfacePathRemoval}
  <ConfirmationDialog
    titleId="network-visualizer-drop-interface-paths-title"
    title={$t('networkVisualizer.interfaceDrop.title')}
    description={$t('networkVisualizer.interfaceDrop.description', {
      count: removal.destinationHashes.length,
      name: removal.displayName,
    })}
    icon="route-off"
    tone="danger"
    confirmLabel={$t('networkVisualizer.interfaceDrop.confirm')}
    oncancel={() => { interfacePathRemoval = undefined; }}
    onconfirm={() => dropInterfacePaths(removal)}
  />
{/if}

{#if identityPathRemoval}
  {@const removal = identityPathRemoval}
  <ConfirmationDialog
    titleId="network-visualizer-drop-identity-paths-title"
    title={$t('networkVisualizer.identityDrop.title')}
    description={$t('networkVisualizer.identityDrop.description', {
      count: removal.destinationHashes.length,
      name: removal.displayName,
    })}
    icon="route-off"
    tone="danger"
    confirmLabel={$t('networkVisualizer.identityDrop.confirm')}
    oncancel={() => { identityPathRemoval = undefined; }}
    onconfirm={() => dropIdentityPaths(removal)}
  />
{/if}

{#if nextHopPathRemoval}
  {@const removal = nextHopPathRemoval}
  <ConfirmationDialog
    titleId="network-visualizer-drop-next-hop-paths-title"
    title={$t('networkVisualizer.nextHopDrop.title')}
    description={$t('networkVisualizer.nextHopDrop.description', {
      count: removal.destinationHashes.length,
      name: removal.displayName,
    })}
    icon="route-off"
    tone="danger"
    confirmLabel={$t('networkVisualizer.nextHopDrop.confirm')}
    oncancel={() => { nextHopPathRemoval = undefined; }}
    onconfirm={() => dropPathsViaNextHop(removal)}
  />
{/if}

{#if interfaceRemoval}
  {@const removal = interfaceRemoval}
  <ConfirmationDialog
    titleId="network-visualizer-remove-interface-title"
    title={$t('networkVisualizer.interfaceRemove.title')}
    description={$t('networkVisualizer.interfaceRemove.description', { name: removal.displayName })}
    icon="trash"
    tone="danger"
    confirmLabel={$t('networkVisualizer.interfaceRemove.confirm')}
    oncancel={() => { interfaceRemoval = undefined; }}
    onconfirm={() => removeInterface(removal)}
  />
{/if}

<style>
  .network-visualizer-page { display: grid; width: 100%; max-width: none; height: 100%; min-width: 0; min-height: 0; grid-template-rows: auto minmax(0, 1fr); gap: 12px; padding: 12px; overflow: hidden; }
  .network-visualizer-header { display: flex; min-width: 0; align-items: center; gap: 13px; }
  .network-visualizer-back { flex: none; min-height: 38px; }
  .network-visualizer-header-copy { display: grid; min-width: 0; gap: 2px; }
  .network-visualizer-header-copy h1 { margin: 0; font-size: 1.16rem; line-height: 1.25; }
  .network-visualizer-header-copy p { margin: 0; color: var(--text-muted); font-size: .72rem; line-height: 1.4; }
  .network-visualizer-panel { position: relative; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; border: 1px solid var(--border); border-radius: var(--radius-md); background: color-mix(in srgb, var(--surface-1) 88%, var(--bg)); box-shadow: var(--shadow); }
  .network-visualizer-topbar { position: absolute; z-index: 4; max-width: 720px; inset: 12px 78px auto 12px; pointer-events: none; }
  .network-visualizer-topbar > * { pointer-events: auto; }
  .network-visualizer-toolbar { display: grid; min-width: 0; grid-template-columns: minmax(180px, 1fr) auto auto; align-items: center; gap: 8px; }
  .network-visualizer-search { min-width: 0; margin: 0; }
  .network-visualizer-search button { display: grid; width: 28px; height: 28px; flex: none; place-items: center; padding: 0; border: 0; border-radius: 7px; color: var(--text-subtle); background: transparent; }
  .network-visualizer-hop-filter { display: flex; height: 42px; align-items: center; gap: 7px; padding-inline: 10px 6px; border: 1px solid var(--border); border-radius: 9px; color: var(--text-muted); background: color-mix(in srgb, var(--surface-2) 92%, transparent); font-size: .62rem; font-weight: 700; backdrop-filter: blur(12px); white-space: nowrap; }
  .network-visualizer-hop-filter input { width: 48px; height: 30px; padding: 0 4px; border: 0; border-radius: 6px; color: var(--text); background: var(--surface-3); text-align: center; }
  .network-visualizer-identity-filter { display: flex; height: 42px; align-items: center; gap: 7px; padding-inline: 10px; border: 1px solid var(--border); border-radius: 9px; color: var(--text-muted); background: color-mix(in srgb, var(--surface-2) 92%, transparent); font-size: .62rem; font-weight: 700; backdrop-filter: blur(12px); cursor: pointer; white-space: nowrap; }
  .network-visualizer-identity-filter input { width: 16px; height: 16px; accent-color: var(--accent); }
  .network-visualizer-bottom-bar { position: absolute; z-index: 3; inset: auto 12px 12px; pointer-events: none; }
  .network-visualizer-summary { display: flex; min-width: 0; flex-wrap: wrap-reverse; align-items: center; gap: 8px; }
  .network-visualizer-summary-counts { display: flex; width: max-content; max-width: 100%; flex: none; flex-wrap: wrap; align-items: center; gap: 8px; }
  .network-visualizer-summary-counts > div { display: inline-flex; align-items: baseline; gap: 6px; padding: 7px 11px; border: 1px solid var(--border); border-radius: 999px; background: color-mix(in srgb, var(--surface-2) 92%, transparent); backdrop-filter: blur(12px); }
  .network-visualizer-summary-counts > div.matches { border-color: color-mix(in srgb, var(--warning) 48%, var(--border)); }
  .network-visualizer-summary strong { color: var(--accent-strong); font-size: .85rem; font-variant-numeric: tabular-nums; }
  .network-visualizer-summary .matches strong { color: var(--warning); }
  .network-visualizer-summary span { color: var(--text-muted); font-size: .66rem; font-weight: 650; }
  .network-visualizer-summary p { max-width: 100%; flex: none; margin: 0; color: var(--warning); font-size: .68rem; }
  :global(.network-visualizer-flow) { width: 100%; height: 100%; --xy-background-color: transparent; }
  .network-visualizer-legend { position: absolute; z-index: 2; display: flex; width: fit-content; max-width: 720px; flex-wrap: wrap; gap: 8px 13px; inset-block-start: 66px; inset-inline-start: 12px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 10px; background: color-mix(in srgb, var(--surface-2) 90%, transparent); backdrop-filter: blur(12px); pointer-events: none; }
  .network-visualizer-legend > span { display: inline-flex; min-width: 0; align-items: center; gap: 6px; color: var(--text-muted); font-size: .62rem; font-weight: 650; white-space: nowrap; }
  .network-visualizer-legend .legend-label { min-width: 0; }
  .network-visualizer-legend i { display: grid; width: 22px; height: 22px; place-items: center; border: 2px solid color-mix(in srgb, currentColor 72%, var(--surface-1)); border-radius: 50%; color: var(--surface-1); background: var(--text-subtle); }
  .network-visualizer-legend i.local { color: #fff; background: #4385e7; }
  .network-visualizer-legend i.interface { color: var(--accent-ink); background: var(--accent); }
  .network-visualizer-legend i.next-hop { color: var(--surface-1); background: var(--warning); }
  .network-visualizer-legend i.destination { color: #fff; background: #8872d8; }
  .network-visualizer-empty { position: absolute; z-index: 2; display: grid; max-width: 310px; gap: 4px; inset-inline-start: 50%; inset-block-end: 64px; padding: 10px 13px; border: 1px solid var(--border); border-radius: 10px; color: var(--text-muted); background: color-mix(in srgb, var(--surface-2) 92%, transparent); text-align: center; translate: -50% 0; pointer-events: none; }
  .network-visualizer-empty strong { color: var(--text); font-size: .74rem; }
  .network-visualizer-empty span { font-size: .65rem; line-height: 1.45; }
  :global(.network-visualizer-flow .svelte-flow__pane) { cursor: grab; }
  :global(.network-visualizer-flow .svelte-flow__pane.dragging) { cursor: grabbing; }
  :global(.network-visualizer-flow .svelte-flow__node-network.draggable) { cursor: grab; }
  :global(.network-visualizer-flow .svelte-flow__node-network.dragging) { cursor: grabbing; }
  :global(.network-visualizer-flow .network-flow-edge .svelte-flow__edge-path) { stroke: var(--border-strong); stroke-width: 2; transition: opacity .18s ease, stroke .18s ease, stroke-width .18s ease; }
  :global(.network-visualizer-flow .network-flow-edge-interface .svelte-flow__edge-path) { stroke: color-mix(in srgb, var(--accent) 72%, var(--border-strong)); stroke-width: 2.6; }
  :global(.network-visualizer-flow .network-flow-edge-direct .svelte-flow__edge-path) { stroke: var(--accent); stroke-width: 2.3; }
  :global(.network-visualizer-flow .network-flow-edge-route .svelte-flow__edge-path) { stroke: #5f91e8; stroke-dasharray: 7 6; opacity: .72; }
  :global(.network-visualizer-flow .network-flow-edge.search-match .svelte-flow__edge-path) { stroke: var(--warning); stroke-width: 3.2; }
  :global(.network-visualizer-flow .network-flow-edge.search-dimmed) { opacity: 1; }
  :global(.network-visualizer-flow .network-flow-edge.search-dimmed .svelte-flow__edge-path) { stroke: color-mix(in srgb, var(--border-strong) 13%, var(--surface-1)); opacity: 1; }
  :global(.network-flow-controls) { top: 12px !important; right: 12px !important; display: flex; overflow: hidden; margin: 0; border: 1px solid var(--border); border-radius: 9px; background: color-mix(in srgb, var(--surface-2) 92%, transparent); box-shadow: none; backdrop-filter: blur(12px); --xy-controls-button-background-color: transparent; --xy-controls-button-background-color-hover: var(--surface-3); --xy-controls-button-border-color: var(--border); --xy-controls-button-color: var(--text); --xy-controls-button-color-hover: var(--text); }
  :global(.network-flow-controls button) { width: 42px; height: 40px; border: 0; border-block-end: 1px solid var(--border); color: var(--text); background: transparent; }
  :global(.network-flow-controls button:last-child) { border-block-end: 0; }
  :global(.network-flow-controls button:hover) { background: var(--surface-3); }
  :global(.network-flow-controls button svg) { fill: currentColor; }

  @media (max-width: 1000px) {
    .network-visualizer-topbar { max-width: none; }
    .network-visualizer-legend { max-width: calc(100% - 90px); }
  }

  @media (max-width: 600px) {
    .network-visualizer-page { padding: 8px; }
    .network-visualizer-topbar { inset: 9px 70px auto 9px; }
    .network-visualizer-header { gap: 9px; }
    .network-visualizer-back span { display: none; }
    .network-visualizer-back { width: 38px; min-height: 38px; padding: 0; }
    .network-visualizer-header-copy h1 { font-size: 1.05rem; }
    .network-visualizer-header-copy p { font-size: .66rem; }
    .network-visualizer-toolbar { grid-template-columns: minmax(0, 1fr) auto auto; }
    .network-visualizer-hop-filter span { display: none; }
    .network-visualizer-hop-filter { padding-inline: 5px; }
    .network-visualizer-identity-filter { padding-inline: 9px; }
    .network-visualizer-identity-filter span { display: none; }
    .network-visualizer-legend { max-width: calc(100% - 79px); gap: 5px 9px; inset: 58px auto auto 9px; padding: 6px 7px; }
    .network-visualizer-legend > span { gap: 4px; overflow: hidden; font-size: .55rem; line-height: 1.1; }
    .network-visualizer-legend i { width: 20px; height: 20px; flex: none; }
    .network-visualizer-legend .legend-label { overflow: hidden; text-overflow: ellipsis; }
    .network-visualizer-bottom-bar { inset: auto 9px 9px; }
    .network-visualizer-summary { gap: 5px; }
    .network-visualizer-summary-counts { gap: 5px; }
    .network-visualizer-summary-counts > div { padding: 6px 9px; }
    .network-visualizer-summary p { width: 100%; }
    :global(.network-flow-controls) { top: 9px !important; right: 9px !important; }
    :global(.network-flow-controls button) { width: 38px; height: 38px; }
  }
</style>
