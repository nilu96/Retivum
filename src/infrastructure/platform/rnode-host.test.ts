import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRNodeInterfaceDraft } from '../../domain/settings';
import type { ByteConnection } from './byte-connections';
import { KissDeframer, RNodeHost, frame, parseRNodeTelemetry } from './rnode-host';

const CMD_DATA = 0x00;
const CMD_FREQUENCY = 0x01;
const CMD_RADIO_STATE = 0x06;
const CMD_DETECT = 0x08;
const CMD_FW_VERSION = 0x50;
const DETECT_RESP = 0x46;

class FakeRNodeConnection implements ByteConnection {
  openCount = 0;
  closeCount = 0;
  failNextDataWrite = false;
  closeWithFailedWrite = false;
  private onData?: (data: Uint8Array) => void;
  private onClosed?: () => void;

  async open(onData: (data: Uint8Array) => void, onClosed: () => void): Promise<void> {
    this.openCount += 1;
    this.onData = onData;
    this.onClosed = onClosed;
  }

  async write(data: Uint8Array): Promise<void> {
    const command = data[1];
    if (command === CMD_DETECT) {
      this.emit(frame(CMD_DETECT, [DETECT_RESP]), frame(CMD_FW_VERSION, [1, 60]));
    } else if (command === CMD_FREQUENCY) {
      this.emit(frame(CMD_RADIO_STATE, [1]));
    } else if (command === CMD_DATA && this.failNextDataWrite) {
      this.failNextDataWrite = false;
      if (this.closeWithFailedWrite) this.onClosed?.();
      throw new Error('GATT operation failed');
    }
  }

  async close(): Promise<void> {
    this.closeCount += 1;
  }

  private emit(...chunks: Uint8Array[]): void {
    this.onData?.(new Uint8Array(chunks.flatMap((chunk) => Array.from(chunk))));
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('RNode KISS framing', () => {
  it('escapes delimiters and reconstructs frames split across transport chunks', () => {
    const encoded = frame(0, [1, 0xc0, 2, 0xdb, 3]);
    const deframer = new KissDeframer(508);
    expect(deframer.process(encoded.slice(0, 4))).toEqual([]);
    expect(deframer.process(encoded.slice(4))).toEqual([{
      command: 0,
      payload: new Uint8Array([1, 0xc0, 2, 0xdb, 3]),
    }]);
  });
});

describe('RNode telemetry', () => {
  it('decodes radio channel and battery reports', () => {
    expect(parseRNodeTelemetry(0x25, new Uint8Array([
      0x00, 0x37,
      0x00, 0xb6,
      0x00, 0x7b,
      0x01, 0xc8,
      157 - 80,
      157 - 92,
      0xff,
    ]))).toEqual({
      airtimeShortPercent: 0.55,
      airtimeLongPercent: 1.82,
      channelLoadShortPercent: 1.23,
      channelLoadLongPercent: 4.56,
      currentRssiDbm: -80,
      noiseFloorDbm: -92,
      interferenceDbm: undefined,
    });
    expect(parseRNodeTelemetry(0x27, new Uint8Array([2, 84]))).toEqual({
      batteryState: 'charging',
      batteryPercent: 84,
    });
  });

  it('decodes packet counters and signed signal reports', () => {
    expect(parseRNodeTelemetry(0x21, new Uint8Array([0, 0, 1, 2]))).toEqual({ radioRxPackets: 258 });
    expect(parseRNodeTelemetry(0x23, new Uint8Array([65]))).toEqual({ lastPacketRssiDbm: -92 });
    expect(parseRNodeTelemetry(0x24, new Uint8Array([0xfc]))).toEqual({ lastPacketSnrDb: -1 });
  });
});

describe('RNode connection recovery', () => {
  it('does not finish an obsolete connection after the host is closed', async () => {
    vi.useFakeTimers();
    const connection = new FakeRNodeConnection();
    const states: string[] = [];
    const logs: string[] = [];
    const host = new RNodeHost(createRNodeInterfaceDraft('ble', 'replaced-rnode'), {
      onPacket: () => undefined,
      onState: (state) => states.push(state),
      log: (code) => logs.push(code),
    }, connection);

    const opening = host.open();
    await vi.advanceTimersByTimeAsync(1_000);
    await host.close();
    await vi.advanceTimersByTimeAsync(10_000);
    await opening;

    expect(states).not.toContain('online');
    expect(logs).not.toContain('RNODE_ONLINE');
  });

  it('reconnects when a failed GATT write has no disconnect event', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const connection = new FakeRNodeConnection();
    const states: Array<{ state: string; code?: string }> = [];
    const logs: string[] = [];
    const host = new RNodeHost(createRNodeInterfaceDraft('ble', 'electron-write-failure'), {
      onPacket: () => undefined,
      onState: (state, code) => states.push({ state, code }),
      log: (code) => logs.push(code),
    }, connection);

    const opening = host.open();
    await vi.advanceTimersByTimeAsync(3_300);
    await opening;
    connection.failNextDataWrite = true;
    host.send(new Uint8Array([1, 2, 3]), true);
    await vi.advanceTimersByTimeAsync(0);

    expect(states.at(-1)).toEqual({ state: 'offline', code: 'RNODE_WRITE_FAILED' });
    expect(connection.closeCount).toBe(1);
    expect(logs.filter((code) => code === 'RNODE_RECONNECT_SCHEDULED')).toHaveLength(1);

    await host.close();
  });

  it('schedules one reconnect when Electron reports both a disconnect and a failed write', async () => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const config = createRNodeInterfaceDraft('ble', 'electron-rnode');
    const connection = new FakeRNodeConnection();
    const states: Array<{ state: string; code?: string }> = [];
    const logs: string[] = [];
    const host = new RNodeHost(config, {
      onPacket: () => undefined,
      onState: (state, code) => states.push({ state, code }),
      log: (code) => logs.push(code),
    }, connection);

    const opening = host.open();
    await vi.advanceTimersByTimeAsync(3_300);
    await opening;
    expect(states).toContainEqual({ state: 'online', code: undefined });

    connection.failNextDataWrite = true;
    connection.closeWithFailedWrite = true;
    host.send(new Uint8Array([1, 2, 3]), true);
    await vi.advanceTimersByTimeAsync(0);

    expect(states.filter(({ state }) => state === 'offline')).toEqual([
      { state: 'offline', code: undefined },
    ]);
    expect(connection.closeCount).toBe(1);
    expect(logs.filter((code) => code === 'RNODE_RECONNECT_SCHEDULED')).toHaveLength(1);

    await host.close();
  });
});
