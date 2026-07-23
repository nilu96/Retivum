import { describe, expect, it } from 'vitest';
import {
  createWebSocketInterfaceDraft,
  createRNodeInterfaceDraft,
  createTcpInterfaceDraft,
  createUdpInterfaceDraft,
  interfaceModes,
  interfaceShouldAnnounceWhenOnline,
  lxmfInboundSourceAllowed,
  normalizeAppPreferences,
  normalizeWebSocketInterfaceConfig,
  normalizeInterfaceConfig,
  normalizeInterfaceMode,
  normalizeDestinationHash,
  resolveLxmfDeliveryPlan,
  tcpAddress,
  udpAddress,
  validateWebSocketInterface,
  validateRNodeInterface,
  validateTcpInterface,
  validateUdpInterface,
  websocketUrl,
} from './settings';

describe('WebSocket interface configuration', () => {
  it('starts disabled at the application level but creates an enabled editor draft', () => {
    const draft = createWebSocketInterfaceDraft('interface-id');
    expect(draft.id).toBe('interface-id');
    expect(draft.connection.host).toBe('localhost');
    expect(draft.enabled).toBe(true);
    expect(draft).not.toHaveProperty('reconnect');
  });

  it('migrates legacy reconnect settings to the automatic driver policy', () => {
    expect(normalizeWebSocketInterfaceConfig({
      ...createWebSocketInterfaceDraft('legacy-interface'),
      schemaVersion: 1,
      reconnect: { enabled: false, initialDelayMs: 60_000 },
    })).toEqual(createWebSocketInterfaceDraft('legacy-interface'));
  });

  it('validates user-controlled fields', () => {
    const draft = createWebSocketInterfaceDraft('interface-id');
    draft.name = '';
    draft.connection.host = '';
    draft.connection.port = 70_000;
    draft.connection.path = 'reticulum';

    expect(validateWebSocketInterface(draft)).toEqual([
      'interface.validation.nameRequired',
      'interface.validation.hostRequired',
      'interface.validation.portInvalid',
      'interface.validation.pathInvalid',
    ]);
  });

  it('renders an IPv6 endpoint safely', () => {
    const draft = createWebSocketInterfaceDraft('interface-id');
    draft.connection.host = '::1';
    expect(websocketUrl(draft)).toBe('ws://[::1]:8765/');
  });
});

describe('platform interface configuration', () => {
  it('persists every Python-compatible interface mode and migrates accepted aliases', () => {
    expect(interfaceModes).toEqual([
      'full', 'pointToPoint', 'accessPoint', 'roaming', 'boundary', 'gateway',
    ]);
    expect(normalizeInterfaceMode('ptp')).toBe('pointToPoint');
    expect(normalizeInterfaceMode('access_point')).toBe('accessPoint');
    expect(normalizeInterfaceMode('gw')).toBe('gateway');
    expect(normalizeInterfaceMode('unsupported')).toBe('full');

    for (const mode of interfaceModes) {
      const draft = createUdpInterfaceDraft(`udp-${mode}`);
      draft.mode = mode;
      expect(normalizeInterfaceConfig(draft)?.mode).toBe(mode);
    }
  });

  it('enables reconnect announcements for new and migrated interfaces', () => {
    expect(createWebSocketInterfaceDraft().reannounceOnReconnect).toBe(true);
    expect(createTcpInterfaceDraft().reannounceOnReconnect).toBe(true);
    expect(createRNodeInterfaceDraft('ble').reannounceOnReconnect).toBe(true);
    expect(createUdpInterfaceDraft().reannounceOnReconnect).toBe(true);

    expect(normalizeInterfaceConfig({
      ...createRNodeInterfaceDraft('ble', 'legacy-rnode'),
      schemaVersion: 2,
      reannounceOnReconnect: undefined,
    })?.reannounceOnReconnect).toBe(true);
    expect(normalizeInterfaceConfig({
      ...createUdpInterfaceDraft('legacy-udp'),
      schemaVersion: 1,
      reannounceOnReconnect: undefined,
    })?.reannounceOnReconnect).toBe(true);

    expect(normalizeInterfaceConfig({
      ...createWebSocketInterfaceDraft('configured-websocket'),
      reannounceOnReconnect: false,
    })?.reannounceOnReconnect).toBe(false);
  });

  it('announces every interface once, then follows the saved instance setting', () => {
    expect(interfaceShouldAnnounceWhenOnline({ reannounceOnReconnect: false }, true)).toBe(true);
    expect(interfaceShouldAnnounceWhenOnline({ reannounceOnReconnect: true }, true)).toBe(true);
    expect(interfaceShouldAnnounceWhenOnline({ reannounceOnReconnect: false }, false)).toBe(false);
    expect(interfaceShouldAnnounceWhenOnline({ reannounceOnReconnect: true }, false)).toBe(true);
  });

  it('normalizes and validates RNode radio and device settings', () => {
    const draft = createRNodeInterfaceDraft('ble', 'rnode-1');
    expect(draft.radio).toMatchObject({
      frequency: 869_525_000,
      txPower: 21,
      spreadingFactor: 8,
      dutyCycle: 10,
    });
    draft.name = 'Field radio';
    expect(validateRNodeInterface(draft)).toEqual(['interface.validation.deviceRequired']);
    draft.connection.deviceId = 'device-id';
    draft.connection.deviceName = 'RNode A1';
    expect(validateRNodeInterface(draft)).toEqual([]);
    expect(draft.radio.dutyCycle).toBe(10);
    expect(normalizeInterfaceConfig(draft)).toEqual(draft);
    expect(normalizeInterfaceConfig({
      ...draft,
      radio: { ...draft.radio, dutyCycle: 12.6 },
    })).toMatchObject({ radio: { dutyCycle: 13 } });
    draft.radio.dutyCycle = 12.5;
    expect(validateRNodeInterface(draft)).toContain('interface.validation.dutyCycleInvalid');
    draft.radio.dutyCycle = 100;
    expect(validateRNodeInterface(draft)).toContain('interface.validation.dutyCycleInvalid');
  });

  it('normalizes and validates native TCP endpoints', () => {
    const draft = createTcpInterfaceDraft('tcp-1');
    draft.name = 'Local gateway';
    draft.connection.host = '127.0.0.1';
    draft.connection.port = 4242;
    expect(validateTcpInterface(draft)).toEqual([]);
    expect(normalizeInterfaceConfig(draft)).toEqual(draft);
    expect(tcpAddress(draft)).toBe('127.0.0.1:4242');
    draft.connection.host = '::1';
    expect(tcpAddress(draft)).toBe('[::1]:4242');
  });

  it('normalizes and validates native UDP listen and forwarding endpoints', () => {
    const draft = createUdpInterfaceDraft('udp-1');
    draft.name = 'LAN broadcast';
    expect(validateUdpInterface(draft)).toEqual([]);
    expect(normalizeInterfaceConfig(draft)).toEqual(draft);
    expect(udpAddress(draft)).toBe('0.0.0.0:4242 → 255.255.255.255:4242');
    draft.connection.listenHost = '::';
    draft.connection.forwardHost = 'ff02::1';
    expect(udpAddress(draft)).toBe('[::]:4242 → [ff02::1]:4242');
    draft.connection.forwardPort = 70_000;
    expect(validateUdpInterface(draft)).toContain('interface.validation.portInvalid');
  });
});

describe('LXMF delivery preferences', () => {
  const hash = '0123456789abcdef0123456789abcdef';

  it('activates propagation when opted in and treats the configured hash as preferred', () => {
    expect(resolveLxmfDeliveryPlan({
      ...normalizeAppPreferences(undefined).lxmf,
      defaultDeliveryMethod: 'direct',
      propagationEnabled: false,
      propagationNodeHash: hash,
    })).toEqual({ method: 'direct', tryPropagation: false, propagationNodeHash: undefined });

    expect(resolveLxmfDeliveryPlan({
      ...normalizeAppPreferences(undefined).lxmf,
      defaultDeliveryMethod: 'opportunistic',
      propagationEnabled: true,
      propagationNodeHash: hash.toUpperCase(),
    })).toEqual({ method: 'opportunistic', tryPropagation: true, propagationNodeHash: hash });

    expect(resolveLxmfDeliveryPlan({
      ...normalizeAppPreferences(undefined).lxmf,
      defaultDeliveryMethod: 'propagated',
    })).toEqual({ method: 'propagated', tryPropagation: true, propagationNodeHash: undefined });

    expect(resolveLxmfDeliveryPlan({
      ...normalizeAppPreferences(undefined).lxmf,
      defaultDeliveryMethod: 'direct',
      propagationEnabled: true,
    })).toEqual({ method: 'direct', tryPropagation: true, propagationNodeHash: undefined });

    expect(normalizeDestinationHash('invalid')).toBeUndefined();
  });

  it('retains propagated delivery and locks propagation on while normalizing preferences', () => {
    expect(normalizeAppPreferences({
      schemaVersion: 1,
      transportEnabled: true,
      theme: 'dark',
      locale: 'en',
      lxmf: { defaultDeliveryMethod: 'propagated', propagationNodeHash: hash },
    })).toMatchObject({
      schemaVersion: 8,
      lxmf: { defaultDeliveryMethod: 'propagated', propagationEnabled: true, propagationNodeHash: hash },
    });
  });

  it('normalizes chat image handling and message retention preferences', () => {
    expect(normalizeAppPreferences({ schemaVersion: 7 }).chat).toEqual({
      imageDownscalingMode: 'ask',
      imageDownscalingMaxLongEdge: 1_500,
      messageRetentionDays: 0,
    });
    expect(normalizeAppPreferences({
      automaticImageDownscaling: true,
    }).chat.imageDownscalingMode).toBe('automatic');
    expect(normalizeAppPreferences({
      chat: {
        imageDownscalingMode: 'never',
        imageDownscalingMaxLongEdge: 200,
        messageRetentionDays: 2,
      },
    }).chat).toEqual({
      imageDownscalingMode: 'never',
      imageDownscalingMaxLongEdge: 320,
      messageRetentionDays: 2,
    });
    expect(normalizeAppPreferences({
      chat: {
        imageDownscalingMaxLongEdge: 20_000,
        messageRetentionDays: 3,
      },
    }).chat).toEqual({
      imageDownscalingMode: 'ask',
      imageDownscalingMaxLongEdge: 8_192,
      messageRetentionDays: 3,
    });
    expect(normalizeAppPreferences({
      chat: { messageRetentionDays: 365 },
    }).chat.messageRetentionDays).toBe(0);
  });

  it('defaults inbound stamp enforcement to zero and accepts Python-compatible costs', () => {
    expect(normalizeAppPreferences({ lxmf: {} }).lxmf.inboundStampCost).toBe(0);
    expect(normalizeAppPreferences({ lxmf: { inboundStampCost: 12 } }).lxmf.inboundStampCost).toBe(12);
    expect(normalizeAppPreferences({ lxmf: { inboundStampCost: 255 } }).lxmf.inboundStampCost).toBe(0);
  });

  it('defaults contact-only reception off and restores an enabled preference', () => {
    expect(normalizeAppPreferences({ lxmf: {} }).lxmf.acceptMessagesFromContactsOnly).toBe(false);
    expect(normalizeAppPreferences({
      lxmf: { acceptMessagesFromContactsOnly: true },
    }).lxmf.acceptMessagesFromContactsOnly).toBe(true);
  });

  it('allows only contact sources when contact-only reception is enabled', () => {
    const preferences = normalizeAppPreferences({
      lxmf: { acceptMessagesFromContactsOnly: true },
    }).lxmf;
    const contact = '1'.repeat(32);
    expect(lxmfInboundSourceAllowed(preferences, contact, new Set([contact]))).toBe(true);
    expect(lxmfInboundSourceAllowed(preferences, '2'.repeat(32), new Set([contact]))).toBe(false);
    preferences.acceptMessagesFromContactsOnly = false;
    expect(lxmfInboundSourceAllowed(preferences, '2'.repeat(32), new Set())).toBe(true);
  });

  it('defaults automatic propagation synchronization to never and validates its interval', () => {
    expect(normalizeAppPreferences({ lxmf: {} }).lxmf.propagationSyncIntervalMinutes).toBe(0);
    expect(normalizeAppPreferences({
      lxmf: { propagationSyncIntervalMinutes: 30 },
    }).lxmf.propagationSyncIntervalMinutes).toBe(30);
    expect(normalizeAppPreferences({
      lxmf: { propagationSyncIntervalMinutes: 5 },
    }).lxmf.propagationSyncIntervalMinutes).toBe(0);
  });

  it('keeps automatic announcements off by default and validates their interval', () => {
    expect(normalizeAppPreferences({ lxmf: {} }).lxmf).toMatchObject({
      autoAnnounceIntervalMinutes: 0,
    });
    expect(normalizeAppPreferences({
      lxmf: { autoAnnounceIntervalMinutes: 30 },
    }).lxmf).toMatchObject({
      autoAnnounceIntervalMinutes: 30,
    });
    expect(normalizeAppPreferences({
      lxmf: { autoAnnounceEnabled: true, autoAnnounceIntervalMinutes: 1 },
    }).lxmf.autoAnnounceIntervalMinutes).toBe(360);
    expect(normalizeAppPreferences({
      lxmf: { autoAnnounceEnabled: false, autoAnnounceIntervalMinutes: 30 },
    }).lxmf.autoAnnounceIntervalMinutes).toBe(0);
  });
});
