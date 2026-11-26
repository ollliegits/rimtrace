import { describe, expect, it } from 'vitest';
import {
  compressSdp,
  decode,
  defaultRealSetup,
  encode,
  expandSdp,
  PROTOCOL_VERSION,
  SnapshotAssembler,
  splitBase64,
  type Message,
  type RealResult,
} from '../src/core';

const fp = '1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9:0A:1B:2C:3D:4E:5F:60:71:82:93:A4:B5:C6:D7:E8:F9:0A';

const chromeOffer = `v=0
o=- 4611731400430051336 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=extmap-allow-mixed
a=msid-semantic: WMS
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=candidate:1467250027 1 udp 2113937151 3b9c2a4e-5f0d-4c1e-8a3b-0d7e1c2f9a66.local 54653 typ host generation 0 network-cost 999
a=candidate:2 1 udp 2113937151 192.168.178.23 50001 typ host generation 0
a=candidate:3 1 tcp 1518280447 192.168.178.23 9 typ host tcptype active generation 0
a=candidate:4 1 udp 2113939711 fe80::1c3e:5ff:fe00:1 52000 typ host generation 0
a=candidate:5 1 udp 2113932031 169.254.12.4 50002 typ host generation 0
a=ice-ufrag:Xk3f
a=ice-pwd:o9fPz1v8Qw7Tn2mLr5sYb3Dh
a=ice-options:trickle
a=fingerprint:sha-256 ${fp}
a=setup:actpass
a=mid:0
a=sctp-port:5000
a=max-message-size:262144
`.replace(/\n/g, '\r\n');

const safariAnswer = `v=0
o=- 6502329182646291211 2 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=ice-ufrag:aB1c
a=ice-pwd:u4Rt7yP0kLm3Nq8WzXc2Vb6H
a=fingerprint:sha-256 ${fp}
a=setup:active
a=mid:0
a=sctp-port:5000
a=max-message-size:262144
a=candidate:1 1 udp 2122260223 10.0.0.7 61234 typ host generation 0
a=candidate:2 1 udp 2122194687 7d1e2f3a-0b4c-4d5e-9f60-718293a4b5c6.local 61235 typ host generation 0
a=end-of-candidates
`.replace(/\n/g, '\r\n');

describe('SDP-Kompression für den QR-Code', () => {
  it('Chrome-Offer: Round-Trip, nur UDP-IPv4/mDNS ohne Link-Local, klein', () => {
    const code = compressSdp(chromeOffer, 'offer');
    const { type, sdp } = expandSdp(code);
    expect(type).toBe('offer');
    expect(sdp).toContain('a=ice-ufrag:Xk3f');
    expect(sdp).toContain('a=ice-pwd:o9fPz1v8Qw7Tn2mLr5sYb3Dh');
    expect(sdp).toContain(`a=fingerprint:sha-256 ${fp}`);
    expect(sdp).toContain('a=setup:actpass');
    expect(sdp).toContain('3b9c2a4e-5f0d-4c1e-8a3b-0d7e1c2f9a66.local 54653');
    expect(sdp).toContain('192.168.178.23 50001');
    expect(sdp).not.toMatch(/fe80|169\.254|tcp/);
    expect(code.length).toBeLessThan(150);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('Safari-Answer: Round-Trip mit Rolle answer', () => {
    const { type, sdp } = expandSdp(compressSdp(safariAnswer, 'answer'));
    expect(type).toBe('answer');
    expect(sdp).toContain('a=setup:active');
    expect(sdp).toContain('10.0.0.7 61234');
    expect(sdp).toContain('7d1e2f3a-0b4c-4d5e-9f60-718293a4b5c6.local 61235');
  });

  it('meldet unbrauchbare SDP und beschädigte Codes', () => {
    expect(() => compressSdp('v=0\r\n', 'offer')).toThrow(/unvollständig/);
    expect(() => compressSdp(chromeOffer.replace(/a=candidate.*\r\n/g, ''), 'offer')).toThrow(/Kandidaten/);
    expect(() => expandSdp(compressSdp(safariAnswer, 'answer').slice(0, 40))).toThrow();
  });
});

describe('Protokoll', () => {
  it('Nachrichten laufen hin und zurück', () => {
    const msgs: Message[] = [
      { t: 'hello', role: 'camera' },
      { t: 'start' },
      { t: 'config-ok' },
      { t: 'config', setup: { ...defaultRealSetup, rimWidthMm: 27.5 } },
      { t: 'snapshot-request', maxSize: 960 },
      { t: 'status', camera: { running: true, fps: 59.9, width: 1920, height: 1080, dropped: 2 } },
    ];
    for (const m of msgs) expect(decode(encode(m))).toEqual({ message: m });
  });

  it('Ergebnis mit NaN (keine Daten) kommt als NaN an, nicht als null', () => {
    const profile = { scale: NaN, revolutions: [], all: { lateral: [0.1, NaN], height: [NaN, 0], count: [1, 0] }, holesPerRev: [], markers: [] };
    const result = { profile, check: { ok: false, messages: [] }, frames: 3, valveRatios: [] } as unknown as RealResult;
    const r = decode(encode({ t: 'result', result }));
    expect(r).toEqual({ message: { t: 'result', result } });
  });

  it('weist falsche Version, fehlende Felgenbreite und Unbekanntes ab', () => {
    expect(decode(JSON.stringify({ v: PROTOCOL_VERSION + 1, t: 'start' }))).toHaveProperty('error');
    expect(decode(encode({ t: 'config', setup: defaultRealSetup }))).toEqual({ error: expect.stringContaining('rimWidthMm') });
    expect(decode(JSON.stringify({ v: 1, t: 'x' }))).toHaveProperty('error');
    expect(decode('{')).toHaveProperty('error');
    expect(decode(JSON.stringify({ v: 1, t: 'status', camera: { fps: 'a' } }))).toHaveProperty('error');
  });

  it('Standbild-Teile: ungeordnet und doppelt', () => {
    const bytes = Uint8Array.from({ length: 30000 }, (_, i) => (i * 7) % 256);
    const parts = splitBase64(bytes, 8000);
    expect(parts).toHaveLength(4);
    const asm = new SnapshotAssembler();
    const msg = (i: number): Extract<Message, { t: 'snapshot' }> => ({ t: 'snapshot', id: 5, index: i, count: parts.length, data: parts[i], width: 960, height: 540, fullWidth: 1920, fullHeight: 1080 });
    expect(asm.add(msg(2))).toBeUndefined();
    expect(asm.add(msg(0))).toBeUndefined();
    expect(asm.add(msg(0))).toBeUndefined();
    expect(asm.add(msg(3))).toBeUndefined();
    expect(asm.add(msg(1))).toEqual(bytes);
    expect(asm.width).toBe(960);
  });
});
