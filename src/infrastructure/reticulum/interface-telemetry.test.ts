import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRNodeInterfaceDraft, createWebSocketInterfaceDraft } from '../../domain/settings';
import { computeRNodeBitrate, InterfaceTelemetryTracker } from './interface-telemetry';

describe('InterfaceTelemetryTracker', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  it('measures live receive and transmit rates independently', () => {
    const tracker = new InterfaceTelemetryTracker(createWebSocketInterfaceDraft('websocket'));
    tracker.recordReceive(100, 1_000);
    tracker.recordTransmit(150, false, 1_000);

    expect(tracker.snapshot(5_000)).toMatchObject({
      rxRateBps: 160,
      txRateBps: 240,
      rxBytes: 100,
      txBytes: 150,
      rxPackets: 1,
      txPackets: 1,
    });
    expect(tracker.snapshot(5_000).bitrateBps).toBe(240);
    expect(tracker.snapshot(7_000)).toMatchObject({
      bitrateBps: 240,
      rxRateBps: 0,
      txRateBps: 0,
    });
  });

  it('retains the highest observed receive or transmit rate as max bitrate', () => {
    const tracker = new InterfaceTelemetryTracker(createWebSocketInterfaceDraft('websocket'));
    tracker.recordReceive(100, 1_000);
    expect(tracker.snapshot(1_000)).toMatchObject({
      bitrateBps: 800,
      rxRateBps: 800,
      txRateBps: 0,
    });

    tracker.recordTransmit(500, false, 2_000);
    expect(tracker.snapshot(2_000)).toMatchObject({
      bitrateBps: 2_000,
      rxRateBps: 400,
      txRateBps: 2_000,
    });

    expect(tracker.snapshot(8_000)).toMatchObject({
      bitrateBps: 2_000,
      rxRateBps: 0,
      txRateBps: 0,
    });
  });

  it('uses computed radio capacity for RNode bitrate', () => {
    const config = createRNodeInterfaceDraft('ble', 'rnode');
    const tracker = new InterfaceTelemetryTracker(config);
    tracker.recordReceive(10_000, 1_000);

    const snapshot = tracker.snapshot(2_000);
    expect(snapshot.rnodeConnectionType).toBe('ble');
    expect(snapshot.rxRateBps).toBe(40_000);
    expect(snapshot.txRateBps).toBe(0);
    expect(snapshot.bitrateBps).toBe(computeRNodeBitrate(
      config.radio.spreadingFactor,
      config.radio.codingRate,
      config.radio.bandwidth,
    ));
  });

  it('tracks announce rates independently by direction', () => {
    const tracker = new InterfaceTelemetryTracker(createWebSocketInterfaceDraft('announces'));
    tracker.recordIncomingAnnounce(1_000);
    tracker.recordIncomingAnnounce(2_000);
    tracker.recordIncomingAnnounce(3_000);
    tracker.recordTransmit(20, true, 1_000);
    tracker.recordTransmit(20, true, 3_000);

    const snapshot = tracker.snapshot(4_000);
    expect(snapshot).toMatchObject({
      incomingAnnounces: 3,
      outgoingAnnounces: 2,
    });
    expect(snapshot.incomingAnnouncesPerSecond).toBe(1);
    expect(snapshot.outgoingAnnouncesPerSecond).toBeCloseTo(2 / 3);
  });
});
