import { writable } from 'svelte/store';

export type AppRoute = 'chat' | 'nomadnet' | 'tools' | 'settings' | 'logs' | 'path-management' | 'provisioning' | 'probe' | 'status';
export type AppNavigationLayer = {
  kind: 'chatConversation';
  destinationHash: string;
};

const defaultRoute: AppRoute = 'chat';
const knownRoutes = new Set<AppRoute>(['chat', 'nomadnet', 'tools', 'settings', 'logs', 'path-management', 'provisioning', 'probe', 'status']);
const navigationStateKey = 'retivumNavigation';
const navigationStateVersion = 1;
const logicalParentRoutes: Partial<Record<AppRoute, AppRoute>> = {
  logs: 'tools',
  'path-management': 'tools',
  provisioning: 'tools',
  probe: 'tools',
  status: 'tools',
};

type ManagedNavigationState = {
  version: typeof navigationStateVersion;
  route: AppRoute;
  parentRoute?: AppRoute;
  layer?: AppNavigationLayer;
  hasLayerParent?: boolean;
};

let pendingTopLevelNavigation: { route: AppRoute; section?: string } | undefined;

function routeFromHash(hash: string): AppRoute {
  const candidate = hash.replace(/^#\/?/, '').split(/[/?]/, 1)[0] as AppRoute;
  return knownRoutes.has(candidate) ? candidate : defaultRoute;
}

export const route = writable<AppRoute>(defaultRoute);
export const navigationLayer = writable<AppNavigationLayer | undefined>();

function historyStateRecord(): Record<string, unknown> {
  const state = window.history.state;
  return state && typeof state === 'object' ? state as Record<string, unknown> : {};
}

function managedNavigationState(): ManagedNavigationState | undefined {
  const candidate = historyStateRecord()[navigationStateKey];
  if (!candidate || typeof candidate !== 'object') return undefined;
  const state = candidate as Partial<ManagedNavigationState>;
  if (state.version !== navigationStateVersion || !state.route || !knownRoutes.has(state.route)) return undefined;
  if (state.parentRoute && !knownRoutes.has(state.parentRoute)) return undefined;
  if (state.layer
    && (state.layer.kind !== 'chatConversation'
      || typeof state.layer.destinationHash !== 'string'
      || state.layer.destinationHash.length === 0)) return undefined;
  return state as ManagedNavigationState;
}

function withManagedNavigationState(state: ManagedNavigationState): Record<string, unknown> {
  return {
    ...historyStateRecord(),
    [navigationStateKey]: state,
  };
}

function currentLayerForRoute(state: ManagedNavigationState | undefined, currentRoute: AppRoute): AppNavigationLayer | undefined {
  return currentRoute === 'chat' && state?.route === currentRoute ? state.layer : undefined;
}

function syncFromLocation(): void {
  const nextRoute = routeFromHash(window.location.hash);
  let state = managedNavigationState();

  if (!state || state.route !== nextRoute) {
    state = {
      version: navigationStateVersion,
      route: nextRoute,
    };
    window.history.replaceState(withManagedNavigationState(state), '', window.location.href);
  }

  if (pendingTopLevelNavigation) {
    const pending = pendingTopLevelNavigation;
    pendingTopLevelNavigation = undefined;
    replaceWithTopLevelRoute(pending.route, pending.section);
    return;
  }

  route.set(nextRoute);
  navigationLayer.set(currentLayerForRoute(state, nextRoute));

  if (!window.location.hash || !knownRoutes.has(window.location.hash.replace(/^#\/?/, '').split(/[/?]/, 1)[0] as AppRoute)) {
    window.history.replaceState(withManagedNavigationState(state), '', `#/${nextRoute}`);
  }
}

function routeHash(nextRoute: AppRoute, section?: string): string {
  const query = section ? `?section=${encodeURIComponent(section)}` : '';
  return `#/${nextRoute}${query}`;
}

function replaceWithTopLevelRoute(nextRoute: AppRoute, section?: string): void {
  const state: ManagedNavigationState = {
    version: navigationStateVersion,
    route: nextRoute,
  };
  window.history.replaceState(
    withManagedNavigationState(state),
    '',
    routeHash(nextRoute, section),
  );
  route.set(nextRoute);
  navigationLayer.set(undefined);
}

export function startRouter(): () => void {
  window.addEventListener('hashchange', syncFromLocation);
  window.addEventListener('popstate', syncFromLocation);
  syncFromLocation();

  return () => {
    pendingTopLevelNavigation = undefined;
    window.removeEventListener('hashchange', syncFromLocation);
    window.removeEventListener('popstate', syncFromLocation);
  };
}

export function navigate(nextRoute: AppRoute, section?: string): void {
  const nextHash = routeHash(nextRoute, section);
  if (window.location.hash === nextHash) return;
  const currentRoute = routeFromHash(window.location.hash);
  const expectedParent = logicalParentRoutes[nextRoute];
  const state: ManagedNavigationState = {
    version: navigationStateVersion,
    route: nextRoute,
    parentRoute: expectedParent === currentRoute ? currentRoute : undefined,
  };
  window.history.pushState(withManagedNavigationState(state), '', nextHash);
  route.set(nextRoute);
  navigationLayer.set(undefined);
}

export function navigateTopLevel(nextRoute: AppRoute, section?: string): void {
  const nextHash = routeHash(nextRoute, section);
  const currentRoute = routeFromHash(window.location.hash);
  const state = managedNavigationState();
  const hasManagedParent = state?.route === currentRoute
    && (state.parentRoute !== undefined || (state.layer !== undefined && state.hasLayerParent));

  if (hasManagedParent) {
    pendingTopLevelNavigation = { route: nextRoute, section };
    window.history.back();
    return;
  }
  if (window.location.hash === nextHash && !state?.layer) return;
  replaceWithTopLevelRoute(nextRoute, section);
}

export function navigateBack(fallbackRoute: AppRoute): void {
  const currentRoute = routeFromHash(window.location.hash);
  const state = managedNavigationState();
  if (state?.route === currentRoute && state.parentRoute === fallbackRoute) {
    window.history.back();
    return;
  }
  const fallbackState: ManagedNavigationState = {
    version: navigationStateVersion,
    route: fallbackRoute,
  };
  window.history.replaceState(
    withManagedNavigationState(fallbackState),
    '',
    routeHash(fallbackRoute),
  );
  route.set(fallbackRoute);
  navigationLayer.set(undefined);
}

export function openChatConversation(destinationHash: string): void {
  const currentRoute = routeFromHash(window.location.hash);
  if (currentRoute !== 'chat') return;
  const currentState = managedNavigationState();
  const state: ManagedNavigationState = {
    version: navigationStateVersion,
    route: 'chat',
    layer: { kind: 'chatConversation', destinationHash },
    hasLayerParent: currentState?.route === 'chat' && currentState.layer?.kind === 'chatConversation'
      ? currentState.hasLayerParent
      : true,
  };
  const nextHistoryState = withManagedNavigationState(state);
  if (currentState?.route === 'chat' && currentState.layer?.kind === 'chatConversation') {
    window.history.replaceState(nextHistoryState, '', window.location.href);
  } else {
    window.history.pushState(nextHistoryState, '', window.location.href);
  }
  navigationLayer.set(state.layer);
}

export function closeNavigationLayer(kind: AppNavigationLayer['kind']): boolean {
  const currentRoute = routeFromHash(window.location.hash);
  const state = managedNavigationState();
  if (state?.route !== currentRoute || state.layer?.kind !== kind) return false;
  if (state.hasLayerParent) {
    window.history.back();
    return true;
  }
  const nextState: ManagedNavigationState = {
    version: navigationStateVersion,
    route: currentRoute,
  };
  window.history.replaceState(withManagedNavigationState(nextState), '', window.location.href);
  navigationLayer.set(undefined);
  return true;
}

export function navigateToSettingsSection(section: string): void {
  navigateTopLevel('settings', section);
  window.setTimeout(() => {
    document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

export function requestedSettingsSection(): string | undefined {
  const query = window.location.hash.split('?', 2)[1];
  return query ? new URLSearchParams(query).get('section') ?? undefined : undefined;
}
