import { writable } from 'svelte/store';

export type AppRoute = 'chat' | 'nomadnet' | 'tools' | 'settings' | 'logs' | 'provisioning' | 'status';

const defaultRoute: AppRoute = 'chat';
const knownRoutes = new Set<AppRoute>(['chat', 'nomadnet', 'tools', 'settings', 'logs', 'provisioning', 'status']);

function routeFromHash(hash: string): AppRoute {
  const candidate = hash.replace(/^#\/?/, '').split(/[/?]/, 1)[0] as AppRoute;
  return knownRoutes.has(candidate) ? candidate : defaultRoute;
}

export const route = writable<AppRoute>(defaultRoute);

export function startRouter(): () => void {
  const sync = () => {
    const nextRoute = routeFromHash(window.location.hash);
    route.set(nextRoute);

    if (!window.location.hash || !knownRoutes.has(window.location.hash.replace(/^#\/?/, '').split(/[/?]/, 1)[0] as AppRoute)) {
      window.history.replaceState(null, '', `#/${nextRoute}`);
    }
  };

  window.addEventListener('hashchange', sync);
  sync();

  return () => window.removeEventListener('hashchange', sync);
}

export function navigate(nextRoute: AppRoute, section?: string): void {
  const query = section ? `?section=${encodeURIComponent(section)}` : '';
  window.location.hash = `#/${nextRoute}${query}`;
}

export function navigateToSettingsSection(section: string): void {
  navigate('settings', section);
  window.setTimeout(() => {
    document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

export function requestedSettingsSection(): string | undefined {
  const query = window.location.hash.split('?', 2)[1];
  return query ? new URLSearchParams(query).get('section') ?? undefined : undefined;
}
