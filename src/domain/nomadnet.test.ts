import { describe, expect, it } from 'vitest';
import {
  NOMAD_DEFAULT_PAGE_PATH,
  encodeNomadRequestData,
  formatNomadAddress,
  nomadLinkFragment,
  nomadPageLoadDeadlineMs,
  nomadRequestPath,
  parseNomadAddress,
  resolveNomadLink,
  unpackNomadPageResponse,
  upsertNomadAnnounce,
} from './nomadnet';

describe('upsertNomadAnnounce', () => {
  it('preserves the last known name and public key when a later projection omits them', () => {
    const previous = {
      id: 'a'.repeat(32),
      destinationHash: 'a'.repeat(32),
      displayName: 'Forest Node',
      publicKey: 'b'.repeat(128),
      hops: 2,
      heardAt: '2026-07-19T08:00:00.000Z',
    };
    expect(upsertNomadAnnounce([previous], {
      id: previous.id,
      destinationHash: previous.destinationHash,
      hops: undefined,
      heardAt: '2026-07-19T09:00:00.000Z',
    })).toEqual([{
      ...previous,
      hops: undefined,
      heardAt: '2026-07-19T09:00:00.000Z',
    }]);
  });

  it('uses a newly announced name when one is present', () => {
    const previous = {
      id: 'a'.repeat(32),
      destinationHash: 'a'.repeat(32),
      displayName: 'Old name',
      heardAt: '2026-07-19T08:00:00.000Z',
    };
    expect(upsertNomadAnnounce([previous], {
      ...previous,
      displayName: 'New name',
      heardAt: '2026-07-19T09:00:00.000Z',
    })[0].displayName).toBe('New name');
  });
});

describe('nomadPageLoadDeadlineMs', () => {
  it('uses a bounded hop-aware deadline', () => {
    expect(nomadPageLoadDeadlineMs()).toBe(90_000);
    expect(nomadPageLoadDeadlineMs(1)).toBe(90_000);
    expect(nomadPageLoadDeadlineMs(2)).toBe(150_000);
    expect(nomadPageLoadDeadlineMs(3)).toBe(210_000);
    expect(nomadPageLoadDeadlineMs(99)).toBe(300_000);
  });
});

describe('parseNomadAddress', () => {
  const hash = '0123456789abcdef0123456789ABCDEF';

  it('normalizes destination and path forms', () => {
    expect(parseNomadAddress(hash)).toEqual({ destinationHash: hash.toLowerCase(), path: '/', requestData: {} });
    expect(parseNomadAddress(`${hash}:docs/start`)).toEqual({ destinationHash: hash.toLowerCase(), path: '/docs/start', requestData: {} });
    expect(parseNomadAddress(`nomadnet://${hash}/docs/start`)).toEqual({ destinationHash: hash.toLowerCase(), path: '/docs/start', requestData: {} });
    expect(parseNomadAddress(`nomadnetwork:///${hash}:/page/index.mu`)).toEqual({
      destinationHash: hash.toLowerCase(),
      path: '/page/index.mu',
      requestData: {},
    });
    expect(parseNomadAddress(`${hash}:/page/stack.mu\`c=heap`)).toEqual({
      destinationHash: hash.toLowerCase(),
      path: '/page/stack.mu',
      requestData: { var_c: 'heap' },
    });
  });

  it('rejects invalid destination hashes', () => {
    expect(parseNomadAddress('not-a-destination:/')).toBeUndefined();
    expect(parseNomadAddress('')).toBeUndefined();
  });

  it('maps an empty node path to the NomadNet index page', () => {
    expect(nomadRequestPath('/')).toBe(NOMAD_DEFAULT_PAGE_PATH);
    expect(nomadRequestPath('/page/docs.mu')).toBe('/page/docs.mu');
  });

  it('formats request parameters as part of a complete NomadNet address', () => {
    expect(formatNomadAddress(hash, '/page/stack.mu', { var_c: 'heap', var_view: 'full' })).toBe(
      `${hash.toLowerCase()}:/page/stack.mu\`c=heap|view=full`,
    );
  });

  it('resolves same-node and cross-node Micron links', () => {
    const current = 'a'.repeat(32);
    const other = 'b'.repeat(32);
    expect(resolveNomadLink(current, 'nomadnetwork://:/page/about.mu')).toEqual({
      destinationHash: current,
      path: '/page/about.mu',
      requestData: {},
    });
    expect(resolveNomadLink(current, `${other}:/page/index.mu`)).toEqual({
      destinationHash: other,
      path: '/page/index.mu',
      requestData: {},
    });
    expect(resolveNomadLink(current, `nomadnetwork:///${other}:/page/index.mu`)).toEqual({
      destinationHash: other,
      path: '/page/index.mu',
      requestData: {},
    });
    expect(resolveNomadLink(current, ':/page/stack.mu\`c=heap|view=full')).toEqual({
      destinationHash: current,
      path: '/page/stack.mu',
      requestData: { var_c: 'heap', var_view: 'full' },
    });
    expect(resolveNomadLink(current, 'lxmf://destination')).toBeUndefined();
  });

  it('encodes request variables as the MessagePack map expected by NomadNet', () => {
    expect(Array.from(encodeNomadRequestData({ var_c: 'heap' }))).toEqual([
      0x81,
      0xa5, 0x76, 0x61, 0x72, 0x5f, 0x63,
      0xa4, 0x68, 0x65, 0x61, 0x70,
    ]);
    expect(Array.from(encodeNomadRequestData({}))).toEqual([0x80]);
  });

  it('recognizes same-page NomadNet fragments', () => {
    expect(nomadLinkFragment('#a-few-demo-outputs')).toBe('a-few-demo-outputs');
    expect(nomadLinkFragment(':#a-few-demo-outputs')).toBe('a-few-demo-outputs');
    expect(nomadLinkFragment('nomadnetwork://#a-few-demo-outputs')).toBe('a-few-demo-outputs');
    expect(nomadLinkFragment('nomadnetwork://:#a-few-demo-outputs')).toBe('a-few-demo-outputs');
    expect(nomadLinkFragment('nomadnetwork:///#a%20few')).toBe('a few');
    expect(nomadLinkFragment('/page/index.mu')).toBeUndefined();
  });

  it('unwraps Reticulum MessagePack page responses', () => {
    const shortPage = new TextEncoder().encode('>Hello');
    expect(Array.from(unpackNomadPageResponse(Uint8Array.of(0xc4, shortPage.length, ...shortPage)) ?? []))
      .toEqual(Array.from(shortPage));

    const longPage = new TextEncoder().encode('x'.repeat(300));
    expect(Array.from(unpackNomadPageResponse(Uint8Array.of(
      0xc5,
      longPage.length >> 8,
      longPage.length & 0xff,
      ...longPage,
    )) ?? [])).toEqual(Array.from(longPage));

    const textPage = new TextEncoder().encode('page');
    expect(Array.from(unpackNomadPageResponse(Uint8Array.of(0xa4, ...textPage)) ?? []))
      .toEqual(Array.from(textPage));
  });

  it('rejects unsupported or malformed MessagePack page responses', () => {
    expect(unpackNomadPageResponse(Uint8Array.of(0xc0))).toBeUndefined();
    expect(unpackNomadPageResponse(Uint8Array.of(0xc4, 4, 1, 2))).toBeUndefined();
    expect(unpackNomadPageResponse(new TextEncoder().encode('raw text'))).toBeUndefined();
  });
});
