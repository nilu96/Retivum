const FLAG = 0x7e;
const ESCAPE = 0x7d;
const ESCAPE_XOR = 0x20;

// Reticulum's TCPInterface advertises this hardware MTU for stream framing.
const DEFAULT_MAX_FRAME_BYTES = 262_144;

/** Frame one Reticulum packet for a TCPInterface byte stream. */
export function encodeHdlcFrame(packet: Uint8Array): Uint8Array {
  let escapedBytes = 0;
  for (const byte of packet) {
    if (byte === FLAG || byte === ESCAPE) escapedBytes += 1;
  }

  const frame = new Uint8Array(packet.byteLength + escapedBytes + 2);
  let offset = 0;
  frame[offset++] = FLAG;
  for (const byte of packet) {
    if (byte === FLAG || byte === ESCAPE) {
      frame[offset++] = ESCAPE;
      frame[offset++] = byte ^ ESCAPE_XOR;
    } else {
      frame[offset++] = byte;
    }
  }
  frame[offset] = FLAG;
  return frame;
}

/**
 * Reassembles Reticulum packets from arbitrarily chunked TCP data.
 *
 * A closing flag is also retained as the possible opening flag for the next
 * frame, which accepts both Reticulum's normal double-flag boundary and peers
 * that share one flag between adjacent frames.
 */
export class HdlcDeframer {
  private buffer: number[] = [];
  private inFrame = false;
  private escapeNext = false;

  constructor(private readonly maxFrameBytes = DEFAULT_MAX_FRAME_BYTES) {}

  process(chunk: Uint8Array): Uint8Array[] {
    const packets: Uint8Array[] = [];

    for (const byte of chunk) {
      if (byte === FLAG) {
        if (this.inFrame && this.buffer.length > 0 && !this.escapeNext) {
          packets.push(Uint8Array.from(this.buffer));
        }
        this.buffer = [];
        this.inFrame = true;
        this.escapeNext = false;
        continue;
      }

      if (!this.inFrame) continue;

      if (this.escapeNext) {
        this.buffer.push(byte ^ ESCAPE_XOR);
        this.escapeNext = false;
      } else if (byte === ESCAPE) {
        this.escapeNext = true;
      } else {
        this.buffer.push(byte);
      }

      if (this.buffer.length > this.maxFrameBytes) this.reset();
    }

    return packets;
  }

  reset(): void {
    this.buffer = [];
    this.inFrame = false;
    this.escapeNext = false;
  }
}
