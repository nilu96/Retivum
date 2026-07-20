const selectedDevices = new Map<string, BluetoothDevice>();

export function rememberBluetoothDevice(device: BluetoothDevice): void {
  selectedDevices.set(device.id, device);
}

export async function resolveBluetoothDevice(deviceId?: string): Promise<{
  device?: BluetoothDevice;
  source: 'selection' | 'authorization' | 'missing';
}> {
  if (!deviceId) return { source: 'missing' };
  const selected = selectedDevices.get(deviceId);
  if (selected) return { device: selected, source: 'selection' };
  const devices = await navigator.bluetooth?.getDevices?.() ?? [];
  const authorized = devices.find((device) => device.id === deviceId);
  if (authorized) rememberBluetoothDevice(authorized);
  return authorized
    ? { device: authorized, source: 'authorization' }
    : { source: 'missing' };
}
