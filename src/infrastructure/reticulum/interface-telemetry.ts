import type {
  InterfaceRuntimeState,
  InterfaceStatusDetails,
  RNodeInterfaceTelemetry,
} from './protocol';
import type { InterfaceConfig } from '../../domain/settings';

const throughputWindowMs = 5_000;
const announceDecayMs = 10_000;
const announceSampleLimit = 48;

interface ByteSample {
  at: number;
  bytes: number;
}

export class InterfaceTelemetryTracker {
  private readonly createdAt = Date.now();
  private readonly rxSamples: ByteSample[] = [];
  private readonly txSamples: ByteSample[] = [];
  private readonly incomingAnnounces: number[] = [];
  private readonly outgoingAnnounces: number[] = [];
  private rxBytes = 0;
  private txBytes = 0;
  private rxPackets = 0;
  private txPackets = 0;
  private state: InterfaceRuntimeState = 'offline';
  private rnode?: RNodeInterfaceTelemetry;

  constructor(private readonly config: InterfaceConfig) {}

  setState(state: InterfaceRuntimeState): void {
    this.state = state;
  }

  recordReceive(bytes: number, at = Date.now()): void {
    if (bytes <= 0) return;
    this.rxBytes += bytes;
    this.rxPackets += 1;
    this.rxSamples.push({ at, bytes });
    this.pruneTraffic(at);
  }

  recordTransmit(bytes: number, announce = false, at = Date.now()): void {
    if (bytes <= 0) return;
    this.txBytes += bytes;
    this.txPackets += 1;
    this.txSamples.push({ at, bytes });
    if (announce) this.appendAnnounce(this.outgoingAnnounces, at);
    this.pruneTraffic(at);
  }

  recordIncomingAnnounce(at = Date.now()): void {
    this.appendAnnounce(this.incomingAnnounces, at);
  }

  updateRNode(telemetry: RNodeInterfaceTelemetry): void {
    this.rnode = { ...this.rnode, ...telemetry };
  }

  snapshot(at = Date.now()): InterfaceStatusDetails {
    this.pruneTraffic(at);
    const measuredBitrate = Math.round(
      (this.sampleBytes(this.rxSamples) + this.sampleBytes(this.txSamples)) * 8
      / Math.max(1_000, Math.min(throughputWindowMs, at - this.createdAt))
      * 1_000,
    );
    const bitrateBps = this.config.type === 'rnode'
      ? computeRNodeBitrate(
          this.config.radio.spreadingFactor,
          this.config.radio.codingRate,
          this.config.radio.bandwidth,
        )
      : measuredBitrate;

    return {
      id: this.config.id,
      name: this.config.name,
      type: this.config.type,
      mode: this.config.mode,
      ...(this.config.type === 'rnode' ? { rnodeConnectionType: this.config.connection.type } : {}),
      state: this.state,
      bitrateBps,
      rxBytes: this.rxBytes,
      txBytes: this.txBytes,
      rxPackets: this.rxPackets,
      txPackets: this.txPackets,
      incomingAnnouncesPerSecond: this.announceRate(this.incomingAnnounces, 2, at),
      outgoingAnnouncesPerSecond: this.announceRate(this.outgoingAnnounces, 1, at),
      ...(this.rnode ? { rnode: { ...this.rnode } } : {}),
    };
  }

  private appendAnnounce(samples: number[], at: number): void {
    samples.push(at);
    if (samples.length > announceSampleLimit) samples.shift();
  }

  private announceRate(samples: number[], minimumSamples: number, at: number): number {
    const count = samples.length;
    if (count <= minimumSamples) return 0;
    const spanMs = at - samples[0];
    if (spanMs > announceDecayMs) samples.shift();
    return spanMs <= 0 ? 0 : count / (spanMs / 1_000);
  }

  private pruneTraffic(at: number): void {
    const cutoff = at - throughputWindowMs;
    while (this.rxSamples[0]?.at < cutoff) this.rxSamples.shift();
    while (this.txSamples[0]?.at < cutoff) this.txSamples.shift();
  }

  private sampleBytes(samples: ByteSample[]): number {
    return samples.reduce((total, sample) => total + sample.bytes, 0);
  }
}

export function computeRNodeBitrate(spreadingFactor: number, codingRate: number, bandwidth: number): number {
  return Math.floor((spreadingFactor * 4 * bandwidth) / (codingRate * 2 ** spreadingFactor));
}
