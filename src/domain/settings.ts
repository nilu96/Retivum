export type ThemePreference = 'system' | 'dark' | 'light';
export type LxmfDeliveryMethod = 'direct' | 'opportunistic' | 'propagated';
export type AutoAnnounceIntervalMinutes = 0 | 15 | 30 | 60 | 180 | 360 | 720 | 1440;
export type PropagationSyncIntervalMinutes = 0 | 15 | 30 | 60 | 180 | 360 | 720 | 1440;
export type WebSocketScheme = 'ws' | 'wss';
export type InterfaceType = 'websocket' | 'rnode' | 'tcp' | 'udp';
export type RNodeConnectionType = 'ble' | 'serial';
export type InterfaceMode = 'full' | 'pointToPoint' | 'accessPoint' | 'roaming' | 'boundary' | 'gateway';
export type ImageDownscalingMode = 'ask' | 'automatic' | 'never';
export type MessageRetentionDays = 0 | 1 | 2 | 3 | 7 | 30 | 90;

export const AUTHORIZED_SERIAL_PORT_ID = 'authorized-serial-port';
export const DEFAULT_CHAT_IMAGE_LONG_EDGE = 1_500;
export const MIN_CHAT_IMAGE_LONG_EDGE = 320;
export const MAX_CHAT_IMAGE_LONG_EDGE = 8_192;
export const messageRetentionDayOptions: readonly MessageRetentionDays[] = [0, 1, 2, 3, 7, 30, 90];

export const interfaceModes: readonly InterfaceMode[] = [
  'full',
  'pointToPoint',
  'accessPoint',
  'roaming',
  'boundary',
  'gateway',
] as const;

export function interfaceShouldAnnounceWhenOnline(
  config: Pick<InterfaceConfig, 'reannounceOnReconnect'>,
  firstOnline: boolean,
): boolean {
  return firstOnline || config.reannounceOnReconnect;
}

export interface LxmfPreferences {
  defaultDeliveryMethod: LxmfDeliveryMethod;
  acceptMessagesFromContactsOnly: boolean;
  propagationEnabled: boolean;
  propagationNodeHash?: string;
  inboundStampCost: number;
  propagationSyncIntervalMinutes: PropagationSyncIntervalMinutes;
  autoAnnounceIntervalMinutes: AutoAnnounceIntervalMinutes;
}

export interface ChatPreferences {
  imageDownscalingMode: ImageDownscalingMode;
  imageDownscalingMaxLongEdge: number;
  messageRetentionDays: MessageRetentionDays;
}

export interface AppPreferences {
  schemaVersion: 8;
  transportEnabled: boolean;
  theme: ThemePreference;
  locale: 'system' | 'en';
  chat: ChatPreferences;
  lxmf: LxmfPreferences;
}

export interface WebSocketInterfaceConfig {
  id: string;
  schemaVersion: 3;
  type: 'websocket';
  name: string;
  enabled: boolean;
  mode: InterfaceMode;
  reannounceOnReconnect: boolean;
  connection: {
    scheme: WebSocketScheme;
    host: string;
    port?: number;
    path: string;
  };
}

export interface RNodeInterfaceConfig {
  id: string;
  schemaVersion: 3;
  type: 'rnode';
  name: string;
  enabled: boolean;
  mode: InterfaceMode;
  reannounceOnReconnect: boolean;
  connection: {
    type: RNodeConnectionType;
    deviceId?: string;
    deviceName?: string;
    usbVendorId?: number;
    usbProductId?: number;
  };
  radio: {
    frequency: number;
    bandwidth: number;
    txPower: number;
    spreadingFactor: number;
    codingRate: number;
    dutyCycle: number;
    flowControl: boolean;
  };
}

export interface TcpInterfaceConfig {
  id: string;
  schemaVersion: 2;
  type: 'tcp';
  name: string;
  enabled: boolean;
  mode: InterfaceMode;
  reannounceOnReconnect: boolean;
  connection: {
    host: string;
    port: number;
  };
}

export interface UdpInterfaceConfig {
  id: string;
  schemaVersion: 2;
  type: 'udp';
  name: string;
  enabled: boolean;
  mode: InterfaceMode;
  reannounceOnReconnect: boolean;
  connection: {
    listenHost: string;
    listenPort: number;
    forwardHost: string;
    forwardPort: number;
  };
}

export type InterfaceConfig = WebSocketInterfaceConfig | RNodeInterfaceConfig | TcpInterfaceConfig | UdpInterfaceConfig;

export const rnodeBandwidths = [
  7_800, 10_400, 15_600, 20_800, 31_250, 41_700, 62_500, 125_000, 250_000, 500_000,
] as const;

export const defaultAppPreferences: AppPreferences = {
  schemaVersion: 8,
  transportEnabled: false,
  theme: 'system',
  locale: 'system',
  chat: {
    imageDownscalingMode: 'ask',
    imageDownscalingMaxLongEdge: DEFAULT_CHAT_IMAGE_LONG_EDGE,
    messageRetentionDays: 0,
  },
  lxmf: {
    defaultDeliveryMethod: 'direct',
    acceptMessagesFromContactsOnly: false,
    propagationEnabled: false,
    inboundStampCost: 0,
    propagationSyncIntervalMinutes: 0,
    autoAnnounceIntervalMinutes: 0,
  },
};

export function normalizeDestinationHash(value: string): string | undefined {
  const normalized = value.trim().toLowerCase();
  return /^[0-9a-f]{32}$/.test(normalized) ? normalized : undefined;
}

export function propagationIsActive(preferences: LxmfPreferences): boolean {
  return preferences.defaultDeliveryMethod === 'propagated' || preferences.propagationEnabled;
}

export function lxmfInboundSourceAllowed(
  preferences: LxmfPreferences,
  sourceHash: string,
  contactDestinationHashes: ReadonlySet<string>,
): boolean {
  return !preferences.acceptMessagesFromContactsOnly || contactDestinationHashes.has(sourceHash);
}

export interface LxmfDeliveryPlan {
  method: LxmfDeliveryMethod;
  tryPropagation: boolean;
  propagationNodeHash?: string;
}

export function resolveLxmfDeliveryPlan(preferences: LxmfPreferences): LxmfDeliveryPlan {
  const tryPropagation = propagationIsActive(preferences);
  const propagationNodeHash = tryPropagation
    ? normalizeDestinationHash(preferences.propagationNodeHash ?? '')
    : undefined;
  return { method: preferences.defaultDeliveryMethod, tryPropagation, propagationNodeHash };
}

export function normalizeAppPreferences(value: unknown): AppPreferences {
  if (!value || typeof value !== 'object') return structuredClone(defaultAppPreferences);
  const source = value as {
    transportEnabled?: unknown;
    automaticImageDownscaling?: unknown;
    theme?: unknown;
    locale?: unknown;
    chat?: {
      imageDownscalingMode?: unknown;
      imageDownscalingMaxLongEdge?: unknown;
      messageRetentionDays?: unknown;
    };
    lxmf?: {
      defaultDeliveryMethod?: unknown;
      acceptMessagesFromContactsOnly?: unknown;
      propagationEnabled?: unknown;
      propagationNodeHash?: unknown;
      inboundStampCost?: unknown;
      propagationSyncIntervalMinutes?: unknown;
      autoAnnounceEnabled?: unknown;
      autoAnnounceIntervalMinutes?: unknown;
    };
  };
  const legacyMethod = source.lxmf?.defaultDeliveryMethod;
  const propagationNodeHash = typeof source.lxmf?.propagationNodeHash === 'string'
    ? normalizeDestinationHash(source.lxmf.propagationNodeHash)
    : undefined;
  const legacyAutomaticImageDownscaling = source.automaticImageDownscaling === true;
  return {
    schemaVersion: 8,
    transportEnabled: source.transportEnabled === true,
    theme: source.theme === 'dark' || source.theme === 'light' ? source.theme : 'system',
    locale: source.locale === 'en' ? 'en' : 'system',
    chat: {
      imageDownscalingMode: normalizeImageDownscalingMode(
        source.chat?.imageDownscalingMode,
        legacyAutomaticImageDownscaling,
      ),
      imageDownscalingMaxLongEdge: normalizeChatImageLongEdge(source.chat?.imageDownscalingMaxLongEdge),
      messageRetentionDays: normalizeMessageRetentionDays(source.chat?.messageRetentionDays),
    },
    lxmf: {
      defaultDeliveryMethod: legacyMethod === 'opportunistic' || legacyMethod === 'propagated' ? legacyMethod : 'direct',
      acceptMessagesFromContactsOnly: source.lxmf?.acceptMessagesFromContactsOnly === true,
      propagationEnabled: typeof source.lxmf?.propagationEnabled === 'boolean'
        ? source.lxmf.propagationEnabled || legacyMethod === 'propagated'
        : legacyMethod === 'propagated',
      propagationNodeHash,
      inboundStampCost: normalizeInboundStampCost(source.lxmf?.inboundStampCost),
      propagationSyncIntervalMinutes: normalizePropagationSyncInterval(source.lxmf?.propagationSyncIntervalMinutes),
      autoAnnounceIntervalMinutes: normalizeAutoAnnounceInterval(
        source.lxmf?.autoAnnounceIntervalMinutes,
        typeof source.lxmf?.autoAnnounceEnabled === 'boolean' ? source.lxmf.autoAnnounceEnabled : undefined,
      ),
    },
  };
}

export function normalizeImageDownscalingMode(
  value: unknown,
  legacyAutomatic = false,
): ImageDownscalingMode {
  if (value === 'automatic' || value === 'never') return value;
  return legacyAutomatic ? 'automatic' : 'ask';
}

export function normalizeChatImageLongEdge(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CHAT_IMAGE_LONG_EDGE;
  return Math.min(MAX_CHAT_IMAGE_LONG_EDGE, Math.max(MIN_CHAT_IMAGE_LONG_EDGE, Math.round(value)));
}

export function normalizeMessageRetentionDays(value: unknown): MessageRetentionDays {
  return typeof value === 'number' && messageRetentionDayOptions.includes(value as MessageRetentionDays)
    ? value as MessageRetentionDays
    : 0;
}

export function normalizeInboundStampCost(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 255 ? value : 0;
}

export function normalizePropagationSyncInterval(value: unknown): PropagationSyncIntervalMinutes {
  const supported: PropagationSyncIntervalMinutes[] = [0, 15, 30, 60, 180, 360, 720, 1440];
  return typeof value === 'number' && supported.includes(value as PropagationSyncIntervalMinutes)
    ? value as PropagationSyncIntervalMinutes
    : defaultAppPreferences.lxmf.propagationSyncIntervalMinutes;
}

export function normalizeAutoAnnounceInterval(value: unknown, legacyEnabled?: boolean): AutoAnnounceIntervalMinutes {
  if (legacyEnabled === false) return 0;
  const supported: AutoAnnounceIntervalMinutes[] = [0, 15, 30, 60, 180, 360, 720, 1440];
  return typeof value === 'number' && supported.includes(value as AutoAnnounceIntervalMinutes)
    ? value as AutoAnnounceIntervalMinutes
    : legacyEnabled === true ? 360 : defaultAppPreferences.lxmf.autoAnnounceIntervalMinutes;
}

export function createWebSocketInterfaceDraft(id: string = crypto.randomUUID()): WebSocketInterfaceConfig {
  return {
    id,
    schemaVersion: 3,
    type: 'websocket',
    name: '',
    enabled: true,
    mode: 'full',
    reannounceOnReconnect: true,
    connection: {
      scheme: 'ws',
      host: 'localhost',
      port: 8765,
      path: '/',
    },
  };
}

export function createRNodeInterfaceDraft(
  connectionType: RNodeConnectionType,
  id: string = crypto.randomUUID(),
): RNodeInterfaceConfig {
  return {
    id,
    schemaVersion: 3,
    type: 'rnode',
    name: '',
    enabled: true,
    mode: 'full',
    reannounceOnReconnect: true,
    connection: { type: connectionType },
    radio: {
      frequency: 869_525_000,
      bandwidth: 125_000,
      txPower: 21,
      spreadingFactor: 8,
      codingRate: 5,
      dutyCycle: 10,
      flowControl: false,
    },
  };
}

export function createTcpInterfaceDraft(id: string = crypto.randomUUID()): TcpInterfaceConfig {
  return {
    id,
    schemaVersion: 2,
    type: 'tcp',
    name: '',
    enabled: true,
    mode: 'full',
    reannounceOnReconnect: true,
    connection: { host: 'localhost', port: 4242 },
  };
}

export function createUdpInterfaceDraft(id: string = crypto.randomUUID()): UdpInterfaceConfig {
  return {
    id,
    schemaVersion: 2,
    type: 'udp',
    name: '',
    enabled: true,
    mode: 'full',
    reannounceOnReconnect: true,
    connection: {
      listenHost: '0.0.0.0',
      listenPort: 4242,
      forwardHost: '255.255.255.255',
      forwardPort: 4242,
    },
  };
}

export function normalizeWebSocketInterfaceConfig(value: unknown): WebSocketInterfaceConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as {
    id?: unknown;
    type?: unknown;
    name?: unknown;
    enabled?: unknown;
    mode?: unknown;
    reannounceOnReconnect?: unknown;
    connection?: {
      scheme?: unknown;
      host?: unknown;
      port?: unknown;
      path?: unknown;
    };
  };
  if (typeof source.id !== 'string' || !source.id || source.type !== 'websocket') return undefined;

  const normalized = createWebSocketInterfaceDraft(source.id);
  normalized.name = typeof source.name === 'string' ? source.name : '';
  normalized.enabled = source.enabled === true;
  normalized.mode = normalizeInterfaceMode(source.mode);
  normalized.reannounceOnReconnect = typeof source.reannounceOnReconnect === 'boolean'
    ? source.reannounceOnReconnect
    : true;
  normalized.connection.scheme = source.connection?.scheme === 'wss' ? 'wss' : 'ws';
  normalized.connection.host = typeof source.connection?.host === 'string' ? source.connection.host : '';
  normalized.connection.port = typeof source.connection?.port === 'number' ? source.connection.port : undefined;
  normalized.connection.path = typeof source.connection?.path === 'string' ? source.connection.path : '/';
  return normalized;
}

export function normalizeRNodeInterfaceConfig(value: unknown): RNodeInterfaceConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<RNodeInterfaceConfig>;
  if (typeof source.id !== 'string' || !source.id || source.type !== 'rnode') return undefined;
  const connectionType = source.connection?.type === 'ble' ? 'ble' : source.connection?.type === 'serial' ? 'serial' : undefined;
  if (!connectionType) return undefined;
  const normalized = createRNodeInterfaceDraft(connectionType, source.id);
  normalized.name = typeof source.name === 'string' ? source.name : '';
  normalized.enabled = source.enabled === true;
  normalized.mode = normalizeInterfaceMode(source.mode);
  normalized.reannounceOnReconnect = typeof source.reannounceOnReconnect === 'boolean'
    ? source.reannounceOnReconnect
    : true;
  normalized.connection.deviceId = typeof source.connection?.deviceId === 'string' ? source.connection.deviceId : undefined;
  normalized.connection.deviceName = typeof source.connection?.deviceName === 'string' ? source.connection.deviceName : undefined;
  normalized.connection.usbVendorId = finiteInteger(source.connection?.usbVendorId);
  normalized.connection.usbProductId = finiteInteger(source.connection?.usbProductId);
  normalized.radio.frequency = finiteNumber(source.radio?.frequency) ?? normalized.radio.frequency;
  normalized.radio.bandwidth = finiteNumber(source.radio?.bandwidth) ?? normalized.radio.bandwidth;
  normalized.radio.txPower = finiteNumber(source.radio?.txPower) ?? normalized.radio.txPower;
  normalized.radio.spreadingFactor = finiteNumber(source.radio?.spreadingFactor) ?? normalized.radio.spreadingFactor;
  normalized.radio.codingRate = finiteNumber(source.radio?.codingRate) ?? normalized.radio.codingRate;
  normalized.radio.dutyCycle = normalizeDutyCycle(source.radio?.dutyCycle);
  normalized.radio.flowControl = source.radio?.flowControl === true;
  return normalized;
}

export function normalizeTcpInterfaceConfig(value: unknown): TcpInterfaceConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<TcpInterfaceConfig>;
  if (typeof source.id !== 'string' || !source.id || source.type !== 'tcp') return undefined;
  const normalized = createTcpInterfaceDraft(source.id);
  normalized.name = typeof source.name === 'string' ? source.name : '';
  normalized.enabled = source.enabled === true;
  normalized.mode = normalizeInterfaceMode(source.mode);
  normalized.reannounceOnReconnect = typeof source.reannounceOnReconnect === 'boolean'
    ? source.reannounceOnReconnect
    : true;
  normalized.connection.host = typeof source.connection?.host === 'string' ? source.connection.host : '';
  normalized.connection.port = finiteNumber(source.connection?.port) ?? normalized.connection.port;
  return normalized;
}

export function normalizeUdpInterfaceConfig(value: unknown): UdpInterfaceConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const source = value as Partial<UdpInterfaceConfig>;
  if (typeof source.id !== 'string' || !source.id || source.type !== 'udp') return undefined;
  const normalized = createUdpInterfaceDraft(source.id);
  normalized.name = typeof source.name === 'string' ? source.name : '';
  normalized.enabled = source.enabled === true;
  normalized.mode = normalizeInterfaceMode(source.mode);
  normalized.reannounceOnReconnect = typeof source.reannounceOnReconnect === 'boolean'
    ? source.reannounceOnReconnect
    : true;
  normalized.connection.listenHost = typeof source.connection?.listenHost === 'string'
    ? source.connection.listenHost
    : normalized.connection.listenHost;
  normalized.connection.listenPort = finiteNumber(source.connection?.listenPort) ?? normalized.connection.listenPort;
  normalized.connection.forwardHost = typeof source.connection?.forwardHost === 'string'
    ? source.connection.forwardHost
    : normalized.connection.forwardHost;
  normalized.connection.forwardPort = finiteNumber(source.connection?.forwardPort) ?? normalized.connection.forwardPort;
  return normalized;
}

export function normalizeInterfaceConfig(value: unknown): InterfaceConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const type = (value as { type?: unknown }).type;
  if (type === 'websocket') return normalizeWebSocketInterfaceConfig(value);
  if (type === 'rnode') return normalizeRNodeInterfaceConfig(value);
  if (type === 'tcp') return normalizeTcpInterfaceConfig(value);
  if (type === 'udp') return normalizeUdpInterfaceConfig(value);
  return undefined;
}

export type InterfaceValidationCode =
  | 'interface.validation.nameRequired'
  | 'interface.validation.hostRequired'
  | 'interface.validation.portInvalid'
  | 'interface.validation.pathInvalid'
  | 'interface.validation.deviceRequired'
  | 'interface.validation.frequencyInvalid'
  | 'interface.validation.bandwidthInvalid'
  | 'interface.validation.txPowerInvalid'
  | 'interface.validation.spreadingFactorInvalid'
  | 'interface.validation.codingRateInvalid'
  | 'interface.validation.dutyCycleInvalid';

export function validateWebSocketInterface(config: WebSocketInterfaceConfig): InterfaceValidationCode[] {
  const errors: InterfaceValidationCode[] = [];

  if (!config.name.trim()) errors.push('interface.validation.nameRequired');
  if (!config.connection.host.trim()) errors.push('interface.validation.hostRequired');
  if (config.connection.port !== undefined && (!Number.isInteger(config.connection.port) || config.connection.port < 1 || config.connection.port > 65_535)) {
    errors.push('interface.validation.portInvalid');
  }
  if (!config.connection.path.startsWith('/')) errors.push('interface.validation.pathInvalid');

  return errors;
}

export function validateRNodeInterface(config: RNodeInterfaceConfig): InterfaceValidationCode[] {
  const errors: InterfaceValidationCode[] = [];
  if (!config.name.trim()) errors.push('interface.validation.nameRequired');
  if (config.connection.type === 'ble' && !config.connection.deviceId) errors.push('interface.validation.deviceRequired');
  if (!Number.isInteger(config.radio.frequency) || config.radio.frequency < 137_000_000 || config.radio.frequency > 3_000_000_000) {
    errors.push('interface.validation.frequencyInvalid');
  }
  if (!rnodeBandwidths.includes(config.radio.bandwidth as typeof rnodeBandwidths[number])) errors.push('interface.validation.bandwidthInvalid');
  if (!Number.isInteger(config.radio.txPower) || config.radio.txPower < 0 || config.radio.txPower > 37) errors.push('interface.validation.txPowerInvalid');
  if (!Number.isInteger(config.radio.spreadingFactor) || config.radio.spreadingFactor < 5 || config.radio.spreadingFactor > 12) {
    errors.push('interface.validation.spreadingFactorInvalid');
  }
  if (!Number.isInteger(config.radio.codingRate) || config.radio.codingRate < 5 || config.radio.codingRate > 8) {
    errors.push('interface.validation.codingRateInvalid');
  }
  if (!Number.isInteger(config.radio.dutyCycle) || config.radio.dutyCycle < 0 || config.radio.dutyCycle >= 100) {
    errors.push('interface.validation.dutyCycleInvalid');
  }
  return errors;
}

export function validateTcpInterface(config: TcpInterfaceConfig): InterfaceValidationCode[] {
  const errors: InterfaceValidationCode[] = [];
  if (!config.name.trim()) errors.push('interface.validation.nameRequired');
  if (!config.connection.host.trim()) errors.push('interface.validation.hostRequired');
  if (!Number.isInteger(config.connection.port) || config.connection.port < 1 || config.connection.port > 65_535) {
    errors.push('interface.validation.portInvalid');
  }
  return errors;
}

export function validateUdpInterface(config: UdpInterfaceConfig): InterfaceValidationCode[] {
  const errors: InterfaceValidationCode[] = [];
  if (!config.name.trim()) errors.push('interface.validation.nameRequired');
  if (!config.connection.listenHost.trim() || !config.connection.forwardHost.trim()) {
    errors.push('interface.validation.hostRequired');
  }
  if (
    !validPort(config.connection.listenPort)
    || !validPort(config.connection.forwardPort)
  ) {
    errors.push('interface.validation.portInvalid');
  }
  return errors;
}

export function websocketUrl(config: WebSocketInterfaceConfig): string {
  const host = config.connection.host.includes(':') && !config.connection.host.startsWith('[')
    ? `[${config.connection.host}]`
    : config.connection.host;
  const port = config.connection.port ? `:${config.connection.port}` : '';
  return `${config.connection.scheme}://${host}${port}${config.connection.path}`;
}

export function tcpAddress(config: TcpInterfaceConfig): string {
  const host = config.connection.host.includes(':') && !config.connection.host.startsWith('[')
    ? `[${config.connection.host}]`
    : config.connection.host;
  return `${host}:${config.connection.port}`;
}

export function udpAddress(config: UdpInterfaceConfig): string {
  const listenHost = formatEndpointHost(config.connection.listenHost);
  const forwardHost = formatEndpointHost(config.connection.forwardHost);
  return `${listenHost}:${config.connection.listenPort} → ${forwardHost}:${config.connection.forwardPort}`;
}

export function interfaceDescription(config: InterfaceConfig, authorizedSerialPortName?: string): string {
  if (config.type === 'websocket') return websocketUrl(config);
  if (config.type === 'tcp') return tcpAddress(config);
  if (config.type === 'udp') return udpAddress(config);
  const device = config.connection.deviceId === AUTHORIZED_SERIAL_PORT_ID
    ? authorizedSerialPortName ?? config.connection.deviceId
    : config.connection.deviceName ?? config.connection.deviceId;
  return `${config.connection.type.toUpperCase()}${device ? ` · ${device}` : ''} · ${config.radio.frequency} Hz`;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function finiteInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

function validPort(value: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= 65_535;
}

function formatEndpointHost(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

function normalizeDutyCycle(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(99, Math.max(0, Math.round(value)));
}

export function normalizeInterfaceMode(value: unknown): InterfaceMode {
  if (value === 'pointToPoint' || value === 'pointtopoint' || value === 'ptp') return 'pointToPoint';
  if (value === 'accessPoint' || value === 'access_point' || value === 'accesspoint' || value === 'ap') return 'accessPoint';
  if (value === 'roaming' || value === 'boundary') return value;
  if (value === 'gateway' || value === 'gw') return 'gateway';
  return 'full';
}
