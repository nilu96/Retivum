import { writable } from 'svelte/store';

export const defaultNetworkVisualizerMaximumHops = 5;

export const networkVisualizerMaximumHops = writable<number | undefined>(
  defaultNetworkVisualizerMaximumHops,
);
export const networkVisualizerGroupByIdentity = writable(false);

export function resetNetworkVisualizerRuntimeSettings(): void {
  networkVisualizerMaximumHops.set(defaultNetworkVisualizerMaximumHops);
  networkVisualizerGroupByIdentity.set(false);
}
