import {
  sortInterfaceConfigurations,
  type InterfaceConfig,
  type RNodeInterfaceConfig,
} from '../../domain/settings';

interface SerialPortSlot {
  readonly id: string;
  port: SerialPort;
  present: boolean;
  electronPortId?: string;
}

export interface AuthorizedSerialPortEntry {
  id: string;
  port: SerialPort;
  configuredInterface?: RNodeInterfaceConfig;
}

function isSerialInterface(config: InterfaceConfig): config is RNodeInterfaceConfig {
  return config.type === 'rnode' && config.connection.type === 'serial';
}

function portKey(port: SerialPort): string {
  const info = port.getInfo();
  return `${info.usbVendorId ?? '*'}:${info.usbProductId ?? '*'}`;
}

function portMatchesConfig(port: SerialPort, config: RNodeInterfaceConfig): boolean {
  if (config.connection.type !== 'serial') return false;
  const info = port.getInfo();
  return (config.connection.usbVendorId === undefined
      || config.connection.usbVendorId === info.usbVendorId)
    && (config.connection.usbProductId === undefined
      || config.connection.usbProductId === info.usbProductId);
}

/**
 * Owns renderer-session serial identity. Slots never compact when a port is
 * absent, so another identical device cannot inherit a reconnecting owner's
 * position. Nothing in this directory is written to application storage.
 */
class SerialPortRegistry {
  private readonly slots: SerialPortSlot[] = [];
  private readonly slotsByPort = new WeakMap<SerialPort, SerialPortSlot>();
  private readonly slotsById = new Map<string, SerialPortSlot>();
  private readonly configuredSlots = new Map<string, SerialPortSlot>();
  private configuredInterfaces: RNodeInterfaceConfig[] = [];
  private nextSlotId = 1;
  private refreshOperation?: Promise<void>;

  configure(interfaces: readonly InterfaceConfig[]): void {
    this.configuredInterfaces = sortInterfaceConfigurations(interfaces).filter(isSerialInterface);
    const configuredIds = new Set(this.configuredInterfaces.map((config) => config.id));
    for (const [interfaceId, slot] of this.configuredSlots) {
      const config = this.configuredInterfaces.find((candidate) => candidate.id === interfaceId);
      if (!configuredIds.has(interfaceId) || !config || !portMatchesConfig(slot.port, config)) {
        this.configuredSlots.delete(interfaceId);
      }
    }
    this.assignConfiguredSlots();
  }

  async entries(interfaces: readonly RNodeInterfaceConfig[]): Promise<AuthorizedSerialPortEntry[]> {
    this.configure(interfaces);
    await this.refresh();
    const interfaceBySlot = new Map(Array.from(this.configuredSlots, ([interfaceId, slot]) => [
      slot,
      this.configuredInterfaces.find((config) => config.id === interfaceId),
    ]));
    return this.slots
      .filter((slot) => slot.present && slot.port.connected !== false)
      .map((slot) => ({
        id: slot.id,
        port: slot.port,
        configuredInterface: interfaceBySlot.get(slot),
      }));
  }

  async resolveConfigured(config: RNodeInterfaceConfig): Promise<SerialPort> {
    await this.refresh();
    let slot = this.configuredSlots.get(config.id);
    if (!slot) {
      this.configure([...this.configuredInterfaces, config]);
      slot = this.configuredSlots.get(config.id);
    }
    if (!slot || !slot.present || slot.port.connected === false) {
      throw new Error('RNODE_SERIAL_NOT_AUTHORIZED');
    }
    return slot.port;
  }

  async resolveSlot(slotId: string, preferredPort?: SerialPort): Promise<SerialPort> {
    if (preferredPort) this.register(preferredPort);
    await this.refresh();
    const slot = this.slotsById.get(slotId);
    if (!slot || !slot.present || slot.port.connected === false) {
      throw new Error('RNODE_SERIAL_NOT_AUTHORIZED');
    }
    return slot.port;
  }

  async selectedEntry(
    port: SerialPort,
    interfaces: readonly RNodeInterfaceConfig[],
    electronPortId?: string,
  ): Promise<AuthorizedSerialPortEntry> {
    this.configure(interfaces);
    await this.refresh();
    const slot = this.register(port, electronPortId);
    const configuredInterfaceId = Array.from(this.configuredSlots).find(([, candidate]) => candidate === slot)?.[0];
    return {
      id: slot.id,
      port: slot.port,
      configuredInterface: this.configuredInterfaces.find((config) => config.id === configuredInterfaceId),
    };
  }

  rememberSelected(port: SerialPort, electronPortId?: string): string {
    return this.register(port, electronPortId).id;
  }

  private async refresh(): Promise<void> {
    if (!navigator.serial) throw new Error('RNODE_SERIAL_UNAVAILABLE');
    if (this.refreshOperation) return this.refreshOperation;
    const operation = (async () => {
      const ports = await navigator.serial!.getPorts();
      this.reconcile(ports);
    })();
    this.refreshOperation = operation;
    try {
      await operation;
    } finally {
      if (this.refreshOperation === operation) this.refreshOperation = undefined;
    }
  }

  private reconcile(ports: readonly SerialPort[]): void {
    for (const slot of this.slots) slot.present = false;

    const unknownByKey = new Map<string, SerialPort[]>();
    for (const port of ports) {
      const known = this.slotsByPort.get(port);
      if (known) {
        known.present = true;
        continue;
      }
      const key = portKey(port);
      const unknown = unknownByKey.get(key) ?? [];
      unknown.push(port);
      unknownByKey.set(key, unknown);
    }

    for (const [key, unknownPorts] of unknownByKey) {
      const vacantSlots = this.slots.filter((slot) => (
        (!slot.present || slot.port.connected === false) && portKey(slot.port) === key
      ));
      for (const port of unknownPorts) {
        const vacant = vacantSlots.shift();
        if (vacant) {
          this.slotsByPort.delete(vacant.port);
          vacant.port = port;
          vacant.present = true;
          this.slotsByPort.set(port, vacant);
        } else {
          this.register(port);
        }
      }
    }
    this.assignConfiguredSlots();
  }

  private register(port: SerialPort, electronPortId?: string): SerialPortSlot {
    const existing = this.slotsByPort.get(port);
    if (existing) {
      existing.present = true;
      if (electronPortId) existing.electronPortId = electronPortId;
      return existing;
    }
    const electronSlot = electronPortId
      ? this.slots.find((slot) => slot.electronPortId === electronPortId)
      : undefined;
    if (electronSlot) {
      this.slotsByPort.delete(electronSlot.port);
      electronSlot.port = port;
      electronSlot.present = port.connected !== false;
      this.slotsByPort.set(port, electronSlot);
      return electronSlot;
    }
    const slot: SerialPortSlot = {
      id: `serial-${this.nextSlotId++}`,
      port,
      present: port.connected !== false,
      ...(electronPortId ? { electronPortId } : {}),
    };
    this.slots.push(slot);
    this.slotsByPort.set(port, slot);
    this.slotsById.set(slot.id, slot);
    this.assignConfiguredSlots();
    return slot;
  }

  private assignConfiguredSlots(): void {
    const usedSlots = new Set(this.configuredSlots.values());
    for (const config of this.configuredInterfaces) {
      if (this.configuredSlots.has(config.id)) continue;
      const slot = this.slots.find((candidate) => (
        !usedSlots.has(candidate) && portMatchesConfig(candidate.port, config)
      ));
      if (!slot) continue;
      this.configuredSlots.set(config.id, slot);
      usedSlots.add(slot);
    }
  }
}

const serialPortRegistry = new SerialPortRegistry();

export function configureSerialPortRegistry(interfaces: readonly InterfaceConfig[]): void {
  serialPortRegistry.configure(interfaces);
}

export function rememberSelectedSerialPort(port: SerialPort, electronPortId?: string): string {
  return serialPortRegistry.rememberSelected(port, electronPortId);
}

export function listAssignedSerialPorts(
  interfaces: readonly RNodeInterfaceConfig[],
): Promise<AuthorizedSerialPortEntry[]> {
  return serialPortRegistry.entries(interfaces);
}

export function selectedSerialPortEntry(
  port: SerialPort,
  interfaces: readonly RNodeInterfaceConfig[],
  electronPortId?: string,
): Promise<AuthorizedSerialPortEntry> {
  return serialPortRegistry.selectedEntry(port, interfaces, electronPortId);
}

export function resolveConfiguredSerialPort(config: RNodeInterfaceConfig): Promise<SerialPort> {
  return serialPortRegistry.resolveConfigured(config);
}

export function resolveSerialPortSlot(slotId: string, preferredPort?: SerialPort): Promise<SerialPort> {
  return serialPortRegistry.resolveSlot(slotId, preferredPort);
}
