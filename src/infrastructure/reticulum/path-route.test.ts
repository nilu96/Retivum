import { describe, expect, it, vi } from 'vitest';
import type { InterfaceConfig } from '../../domain/settings';
import { resolveProbeRoute } from './path-route';

const destinationHash = '12'.repeat(16);
const nextHopHash = '34'.repeat(16);
const interfaceConfig: InterfaceConfig = {
  id: 'interface-one',
  schemaVersion: 3,
  type: 'websocket',
  name: 'Community Hub',
  enabled: true,
  mode: 'full',
  reannounceOnReconnect: true,
  connection: { scheme: 'wss', host: 'example.test', path: '/' },
};

describe('resolveProbeRoute', () => {
  it('maps the path next hop and runtime interface to application metadata', () => {
    const stableInterfaceId = vi.fn().mockReturnValue(interfaceConfig.id);

    expect(resolveProbeRoute({
      paths: [{
        destinationHash: Uint8Array.from({ length: 16 }, () => 0x12),
        interfaceIndex: 7,
        nextHop: Uint8Array.from({ length: 16 }, () => 0x34),
      }],
    }, destinationHash, [interfaceConfig], stableInterfaceId)).toEqual({
      viaHash: nextHopHash,
      interfaceName: 'Community Hub',
      interfaceType: 'websocket',
    });
    expect(stableInterfaceId).toHaveBeenCalledWith(7);
  });

  it('uses a directly connected destination as its own next hop', () => {
    expect(resolveProbeRoute({
      paths: [{ destination_hash: Array(16).fill(0x12), interface_index: 0, next_hop: null }],
    }, destinationHash, [], () => undefined)).toEqual({ viaHash: destinationHash });
  });

  it('returns no route metadata when the destination has no path', () => {
    expect(resolveProbeRoute({ paths: [] }, destinationHash, [interfaceConfig], () => interfaceConfig.id)).toEqual({});
  });
});
