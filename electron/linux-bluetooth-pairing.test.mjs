import { describe, expect, it, vi } from 'vitest';
import { pairLinuxBluetoothDevice } from './linux-bluetooth-pairing.mjs';

const DEVICE_PATH = '/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF';

function fakeBluez(paired) {
  let exportedAgent;
  class Interface {
    constructor(name) { this.name = name; }
    static configureMembers() {}
  }
  const properties = {
    Get: vi.fn().mockResolvedValue({ value: paired }),
    Set: vi.fn().mockResolvedValue(undefined),
  };
  const deviceInterface = { Pair: vi.fn().mockResolvedValue(undefined) };
  const agentManager = {
    RegisterAgent: vi.fn().mockResolvedValue(undefined),
    UnregisterAgent: vi.fn().mockResolvedValue(undefined),
  };
  const objects = {
    '/': {
      getInterface: () => ({
        GetManagedObjects: vi.fn().mockResolvedValue({
          [DEVICE_PATH]: {
            'org.bluez.Device1': { Address: { value: 'AA:BB:CC:DD:EE:FF' } },
          },
        }),
      }),
    },
    [DEVICE_PATH]: {
      getInterface: (name) => (
        name === 'org.freedesktop.DBus.Properties' ? properties : deviceInterface
      ),
    },
    '/org/bluez': { getInterface: () => agentManager },
  };
  const bus = {
    getProxyObject: vi.fn(async (_service, path) => objects[path]),
    export: vi.fn((_path, agent) => { exportedAgent = agent; }),
    unexport: vi.fn(),
    disconnect: vi.fn(),
  };
  const dbus = {
    interface: { Interface },
    systemBus: () => bus,
    DBusError: class extends Error {},
    Variant: class {
      constructor(signature, value) {
        this.signature = signature;
        this.value = value;
      }
    },
  };
  return { agentManager, bus, dbus, deviceInterface, exportedAgent: () => exportedAgent, properties };
}

describe('Linux BlueZ RNode pairing', () => {
  it('does not request a PIN when BlueZ already has a durable bond', async () => {
    const bluez = fakeBluez(true);
    const requestPin = vi.fn().mockResolvedValue('123456');

    await pairLinuxBluetoothDevice('AA:BB:CC:DD:EE:FF', requestPin, { dbus: bluez.dbus });

    expect(requestPin).not.toHaveBeenCalled();
    expect(bluez.agentManager.RegisterAgent).not.toHaveBeenCalled();
    expect(bluez.deviceInterface.Pair).not.toHaveBeenCalled();
    expect(bluez.bus.disconnect).toHaveBeenCalled();
  });

  it('requests the PIN only after determining that the device is unpaired', async () => {
    const bluez = fakeBluez(false);
    const requestPin = vi.fn().mockResolvedValue('654321');
    bluez.deviceInterface.Pair.mockImplementation(async () => {
      expect(bluez.exportedAgent().RequestPasskey(DEVICE_PATH)).toBe(654321);
    });

    await pairLinuxBluetoothDevice('AA:BB:CC:DD:EE:FF', requestPin, { dbus: bluez.dbus });

    expect(requestPin).toHaveBeenCalledOnce();
    expect(bluez.agentManager.RegisterAgent).toHaveBeenCalledWith(
      '/de/nilu96/retivum/bluetooth_agent',
      'KeyboardOnly',
    );
    expect(bluez.deviceInterface.Pair).toHaveBeenCalledOnce();
    expect(bluez.properties.Set).toHaveBeenCalled();
  });
});
