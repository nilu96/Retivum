import { describe, expect, it } from 'vitest';
import {
  defaultAppPreferences,
  type AppPreferences,
  type WebSocketInterfaceConfig,
} from '../../domain/settings';
import type { RuntimeConfiguration } from './protocol';
import { requiresReticulumRuntimeRebuild } from './runtime-configuration';

function configuration(): RuntimeConfiguration {
  return {
    preferences: structuredClone(defaultAppPreferences),
    interfaces: [],
  };
}

function withPreferences(
  current: RuntimeConfiguration,
  update: (preferences: AppPreferences) => void,
): RuntimeConfiguration {
  const next = structuredClone(current);
  update(next.preferences);
  return next;
}

describe('requiresReticulumRuntimeRebuild', () => {
  it('keeps the live runtime for outbound and scheduling preferences', () => {
    const current = configuration();
    const propagated = withPreferences(current, (preferences) => {
      preferences.theme = 'dark';
      preferences.lxmf.defaultDeliveryMethod = 'propagated';
      preferences.lxmf.propagationEnabled = true;
      preferences.lxmf.propagationNodeHash = '0123456789abcdef0123456789abcdef';
      preferences.lxmf.autoAnnounceIntervalMinutes = 60;
      preferences.lxmf.propagationSyncIntervalMinutes = 30;
      preferences.chat.imageDownscalingMode = 'automatic';
      preferences.chat.imageDownscalingMaxLongEdge = 1_200;
      preferences.chat.messageRetentionDays = 30;
    });

    expect(requiresReticulumRuntimeRebuild(current, propagated)).toBe(false);
  });

  it('rebuilds when node construction or interfaces change', () => {
    const current = configuration();
    expect(requiresReticulumRuntimeRebuild(undefined, current)).toBe(true);
    expect(requiresReticulumRuntimeRebuild(current, withPreferences(current, (preferences) => {
      preferences.transportEnabled = true;
    }))).toBe(true);
    expect(requiresReticulumRuntimeRebuild(current, withPreferences(current, (preferences) => {
      preferences.lxmf.inboundStampCost = 4;
    }))).toBe(true);

    const websocket: WebSocketInterfaceConfig = {
      id: 'interface-1',
      schemaVersion: 3,
      type: 'websocket',
      name: 'Home relay',
      enabled: true,
      mode: 'full',
      reannounceOnReconnect: true,
      connection: { scheme: 'ws', host: 'localhost', port: 8765, path: '/' },
    };
    expect(requiresReticulumRuntimeRebuild(current, { ...current, interfaces: [websocket] })).toBe(true);
  });
});
