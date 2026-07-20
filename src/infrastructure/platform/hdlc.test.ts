import { describe, expect, it } from 'vitest';
import { encodeHdlcFrame, HdlcDeframer } from './hdlc';

describe('Reticulum TCP HDLC framing', () => {
  it('wraps packets and escapes flag and escape bytes', () => {
    expect(Array.from(encodeHdlcFrame(Uint8Array.from([0x00, 0x7e, 0x7d, 0xff])))).toEqual([
      0x7e,
      0x00,
      0x7d, 0x5e,
      0x7d, 0x5d,
      0xff,
      0x7e,
    ]);
  });

  it('reassembles a frame split across TCP chunks', () => {
    const deframer = new HdlcDeframer();
    const framed = encodeHdlcFrame(Uint8Array.from([0x01, 0x7e, 0x7d, 0x02]));

    expect(deframer.process(framed.slice(0, 3))).toEqual([]);
    expect(deframer.process(framed.slice(3, 5))).toEqual([]);
    expect(deframer.process(framed.slice(5))).toEqual([
      Uint8Array.from([0x01, 0x7e, 0x7d, 0x02]),
    ]);
  });

  it('extracts several packets from one TCP chunk', () => {
    const first = encodeHdlcFrame(Uint8Array.from([0x01, 0x02]));
    const second = encodeHdlcFrame(Uint8Array.from([0x03, 0x04]));
    const chunk = new Uint8Array(first.byteLength + second.byteLength);
    chunk.set(first);
    chunk.set(second, first.byteLength);

    expect(new HdlcDeframer().process(chunk)).toEqual([
      Uint8Array.from([0x01, 0x02]),
      Uint8Array.from([0x03, 0x04]),
    ]);
  });

  it('drops an oversized partial frame and resynchronises on the next flag', () => {
    const deframer = new HdlcDeframer(3);

    expect(deframer.process(Uint8Array.from([0x7e, 1, 2, 3, 4, 0x7e]))).toEqual([]);
    expect(deframer.process(encodeHdlcFrame(Uint8Array.from([5, 6])))).toEqual([
      Uint8Array.from([5, 6]),
    ]);
  });
});
