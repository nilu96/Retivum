interface BluetoothRemoteGattCharacteristic extends EventTarget {
  readonly value?: DataView;
  writeValue(value: BufferSource): Promise<void>;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  startNotifications(): Promise<BluetoothRemoteGattCharacteristic>;
  stopNotifications(): Promise<BluetoothRemoteGattCharacteristic>;
}

interface BluetoothRemoteGattService {
  getCharacteristic(characteristic: string): Promise<BluetoothRemoteGattCharacteristic>;
}

interface BluetoothRemoteGattServer {
  readonly connected: boolean;
  connect(): Promise<BluetoothRemoteGattServer>;
  disconnect(): void;
  getPrimaryService(service: string): Promise<BluetoothRemoteGattService>;
}

interface BluetoothDevice extends EventTarget {
  readonly id: string;
  readonly name?: string;
  readonly gatt?: BluetoothRemoteGattServer;
}

interface Bluetooth {
  requestDevice(options: { filters: Array<{ services: string[] }>; optionalServices?: string[] }): Promise<BluetoothDevice>;
  getDevices?(): Promise<BluetoothDevice[]>;
}

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPort {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  getInfo(): SerialPortInfo;
  open(options: { baudRate: number; dataBits: number; stopBits: number; parity: 'none'; flowControl: 'none' }): Promise<void>;
  close(): Promise<void>;
}

interface Serial {
  requestPort(): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}

interface Navigator {
  bluetooth?: Bluetooth;
  serial?: Serial;
}

interface DesktopSocketEvent {
  id: string;
  type: 'connected' | 'data' | 'closed' | 'error';
  data?: number[];
  errorCode?: string;
}

interface RetivumSocketBridge {
  open(options: { id: string; host: string; port: number }): Promise<void>;
  write(options: { id: string; data: number[] }): Promise<void>;
  close(options: { id: string }): Promise<void>;
  onEvent(listener: (event: DesktopSocketEvent) => void): () => void;
}

interface DesktopUdpSocketEvent {
  id: string;
  type: 'data' | 'closed' | 'error';
  data?: number[];
  errorCode?: string;
}

interface RetivumUdpSocketBridge {
  open(options: {
    id: string;
    listenHost: string;
    listenPort: number;
    forwardHost: string;
    forwardPort: number;
  }): Promise<void>;
  send(options: { id: string; data: number[] }): Promise<void>;
  close(options: { id: string }): Promise<void>;
  onEvent(listener: (event: DesktopUdpSocketEvent) => void): () => void;
}

interface DesktopDeviceSelectionRequest {
  requestId: string;
  type: 'ble' | 'serial';
  devices: Array<{ id: string; name: string; detail?: string }>;
}

type DesktopBluetoothPairingKind = 'confirm' | 'confirmPin' | 'providePin';

interface DesktopBluetoothPairingRequest {
  requestId: string;
  deviceId: string;
  pairingKind: DesktopBluetoothPairingKind;
  pin?: string;
}

interface RetivumDesktopDeviceBridge {
  respond(response: { requestId: string; deviceId?: string }): Promise<void>;
  respondPairing(response: { requestId: string; confirmed: boolean; pin?: string }): Promise<void>;
  onSelectionRequest(listener: (request: DesktopDeviceSelectionRequest) => void): () => void;
  onPairingRequest(listener: (request: DesktopBluetoothPairingRequest) => void): () => void;
}

interface Window {
  retivumDesktopSockets?: RetivumSocketBridge;
  retivumMobileSockets?: RetivumSocketBridge;
  retivumDesktopUdpSockets?: RetivumUdpSocketBridge;
  retivumDesktopDevices?: RetivumDesktopDeviceBridge;
}
