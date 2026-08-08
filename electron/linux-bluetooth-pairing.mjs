import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const BLUEZ_SERVICE = 'org.bluez';
const ROOT_PATH = '/';
const AGENT_PATH = '/de/nilu96/retivum/bluetooth_agent';
const AGENT_MANAGER = 'org.bluez.AgentManager1';
const DEVICE_INTERFACE = 'org.bluez.Device1';
const PROPERTIES_INTERFACE = 'org.freedesktop.DBus.Properties';
const OBJECT_MANAGER = 'org.freedesktop.DBus.ObjectManager';
const RNODE_NUS_SERVICE = '6e400001b5a3f393e0a9e50e24dcca9e';

export async function pairLinuxBluetoothDevice(deviceAddress, requestPin, dependencies = {}) {
  const dbus = dependencies.dbus ?? require('dbus-next');
  const { Interface } = dbus.interface;
  const bus = dbus.systemBus();
  let registered = false;
  let pin;

  class RNodePairingAgent extends Interface {
    constructor() {
      super('org.bluez.Agent1');
    }

    Release() {}

    RequestPinCode(devicePath) {
      assertExpectedDevice(devicePath);
      return pin;
    }

    DisplayPinCode(devicePath) {
      assertExpectedDevice(devicePath);
    }

    RequestPasskey(devicePath) {
      assertExpectedDevice(devicePath);
      return Number.parseInt(pin, 10);
    }

    DisplayPasskey(devicePath) {
      assertExpectedDevice(devicePath);
    }

    RequestConfirmation(devicePath, passkey) {
      assertExpectedDevice(devicePath);
      if (Number.parseInt(pin, 10) !== Number(passkey)) reject('The displayed passkey did not match');
    }

    RequestAuthorization(devicePath) {
      assertExpectedDevice(devicePath);
    }

    AuthorizeService(devicePath, uuid) {
      assertExpectedDevice(devicePath);
      if (normalizeUuid(uuid) !== RNODE_NUS_SERVICE) reject('Only the RNode UART service is authorized');
    }

    Cancel() {
      reject('Pairing was cancelled');
    }
  }

  RNodePairingAgent.configureMembers({
    methods: {
      Release: {},
      RequestPinCode: { inSignature: 'o', outSignature: 's' },
      DisplayPinCode: { inSignature: 'os' },
      RequestPasskey: { inSignature: 'o', outSignature: 'u' },
      DisplayPasskey: { inSignature: 'ouq' },
      RequestConfirmation: { inSignature: 'ou' },
      RequestAuthorization: { inSignature: 'o' },
      AuthorizeService: { inSignature: 'os' },
      Cancel: {},
    },
  });

  let expectedDevicePath;
  function assertExpectedDevice(devicePath) {
    if (devicePath !== expectedDevicePath) reject('Unexpected Bluetooth device');
  }
  function reject(message) {
    throw new dbus.DBusError('org.bluez.Error.Rejected', message);
  }

  try {
    const root = await bus.getProxyObject(BLUEZ_SERVICE, ROOT_PATH);
    const managed = await root.getInterface(OBJECT_MANAGER).GetManagedObjects();
    expectedDevicePath = findDevicePath(managed, deviceAddress);
    if (!expectedDevicePath) throw new Error('RNODE_BLE_DEVICE_NOT_FOUND');

    const device = await bus.getProxyObject(BLUEZ_SERVICE, expectedDevicePath);
    const properties = device.getInterface(PROPERTIES_INTERFACE);
    const paired = unwrapVariant(await properties.Get(DEVICE_INTERFACE, 'Paired')) === true;
    if (paired) return;
    pin = await requestPin();

    const managerObject = await bus.getProxyObject(BLUEZ_SERVICE, '/org/bluez');
    const manager = managerObject.getInterface(AGENT_MANAGER);
    bus.export(AGENT_PATH, new RNodePairingAgent());
    await manager.RegisterAgent(AGENT_PATH, 'KeyboardOnly');
    registered = true;
    await device.getInterface(DEVICE_INTERFACE).Pair();
    await properties.Set(DEVICE_INTERFACE, 'Trusted', new dbus.Variant('b', true));
  } finally {
    if (registered) {
      try {
        const managerObject = await bus.getProxyObject(BLUEZ_SERVICE, '/org/bluez');
        await managerObject.getInterface(AGENT_MANAGER).UnregisterAgent(AGENT_PATH);
      } catch { /* bluetoothd may have restarted */ }
    }
    try { bus.unexport(AGENT_PATH); } catch { /* not exported */ }
    try { bus.disconnect(); } catch { /* already disconnected */ }
  }
}

function findDevicePath(managed, expectedAddress) {
  const normalized = normalizeAddress(expectedAddress);
  for (const [path, interfaces] of Object.entries(managed ?? {})) {
    const device = interfaces?.[DEVICE_INTERFACE];
    if (normalizeAddress(unwrapVariant(device?.Address)) === normalized) return path;
  }
  return undefined;
}

function unwrapVariant(value) {
  return value && typeof value === 'object' && 'value' in value ? value.value : value;
}

function normalizeAddress(value) {
  return typeof value === 'string' ? value.replace(/[^0-9a-f]/gi, '').toLowerCase() : '';
}

function normalizeUuid(value) {
  return typeof value === 'string' ? value.replace(/-/g, '').toLowerCase() : '';
}
