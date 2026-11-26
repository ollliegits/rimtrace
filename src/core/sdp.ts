/**
 * Kompakte Darstellung einer WebRTC-Sitzungsbeschreibung (nur Datenkanal, ohne STUN/TURN) für einen QR-Code.
 * Gepackt werden nur die Angaben, die für die Verbindung nötig sind: Rolle, ICE-Zugangsdaten, DTLS-Fingerabdruck und
 * UDP-Host-Kandidaten (IPv4 oder mDNS-Name). Der Rest wird beim Entpacken als Standard-SDP von Chrome/Safari ergänzt.
 */

export interface PackedSdp {
  type: 'offer' | 'answer';
  ufrag: string;
  pwd: string;
  /** 32 Byte, SHA-256. */
  fingerprint: Uint8Array;
  candidates: Candidate[];
}

export type Candidate = { kind: 'ip'; ip: string; port: number } | { kind: 'mdns'; id: string; port: number };

const maxCandidates = 8;
const uuid = /^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/i;

function parseCandidate(line: string): Candidate | undefined {
  const f = line.slice('a=candidate:'.length).trim().split(/\s+/);
  const [, component, proto, , addr, port, , type] = f;
  if (component !== '1' || proto.toLowerCase() !== 'udp' || type !== 'host') return undefined;
  const p = Number(port);
  const m = uuid.exec(addr);
  if (m) return { kind: 'mdns', id: m.slice(1).join(''), port: p };
  const ip = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(addr);
  if (!ip || addr.startsWith('169.254.')) return undefined;
  return { kind: 'ip', ip: addr, port: p };
}

export function parseSdp(sdp: string, type: 'offer' | 'answer'): PackedSdp {
  const lines = sdp.split(/\r?\n/);
  const find = (prefix: string) => lines.find((l) => l.startsWith(prefix))?.slice(prefix.length).trim();
  const ufrag = find('a=ice-ufrag:');
  const pwd = find('a=ice-pwd:');
  const fp = find('a=fingerprint:');
  if (!ufrag || !pwd || !fp) throw new Error('SDP unvollständig (ufrag, pwd oder Fingerabdruck fehlt)');
  const [algo, hex] = fp.split(/\s+/);
  const fingerprint = Uint8Array.from(hex.split(':').map((h) => parseInt(h, 16)));
  if (algo.toLowerCase() !== 'sha-256' || fingerprint.length !== 32) throw new Error('nur SHA-256-Fingerabdruck wird unterstützt');
  const candidates = lines
    .filter((l) => l.startsWith('a=candidate:'))
    .map(parseCandidate)
    .filter((c): c is Candidate => c !== undefined)
    .slice(0, maxCandidates);
  if (!candidates.length) throw new Error('keine verwendbaren Host-Kandidaten (UDP, IPv4 oder mDNS)');
  return { type, ufrag, pwd, fingerprint, candidates };
}

const text = new TextEncoder();
const bytesToB64Url = (b: number[]) => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const b64UrlToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export function packSdp(p: PackedSdp): string {
  const out: number[] = [p.type === 'answer' ? 1 : 0];
  for (const s of [p.ufrag, p.pwd]) {
    const b = text.encode(s);
    out.push(b.length, ...b);
  }
  out.push(...p.fingerprint, p.candidates.length);
  for (const c of p.candidates) {
    if (c.kind === 'ip') out.push(0, ...c.ip.split('.').map(Number));
    else out.push(1, ...(c.id.match(/../g) as string[]).map((h) => parseInt(h, 16)));
    out.push(c.port >> 8, c.port & 255);
  }
  return bytesToB64Url(out);
}

export function unpackSdpFields(code: string): PackedSdp {
  const b = b64UrlToBytes(code.trim());
  let o = 0;
  const type = b[o++] === 1 ? 'answer' : 'offer';
  const str = () => {
    const n = b[o++];
    const s = new TextDecoder().decode(b.subarray(o, o + n));
    o += n;
    return s;
  };
  const ufrag = str();
  const pwd = str();
  const fingerprint = b.slice(o, o + 32);
  o += 32;
  const n = b[o++];
  const candidates: Candidate[] = [];
  for (let i = 0; i < n; i++) {
    const kind = b[o++];
    let c: Candidate;
    if (kind === 0) {
      c = { kind: 'ip', ip: Array.from(b.subarray(o, o + 4)).join('.'), port: 0 };
      o += 4;
    } else {
      c = { kind: 'mdns', id: Array.from(b.subarray(o, o + 16), (x) => x.toString(16).padStart(2, '0')).join(''), port: 0 };
      o += 16;
    }
    c.port = (b[o] << 8) | b[o + 1];
    o += 2;
    candidates.push(c);
  }
  if (o > b.length || !ufrag || !pwd) throw new Error('Code beschädigt oder unvollständig');
  return { type, ufrag, pwd, fingerprint, candidates };
}

/** Standard-SDP für einen reinen Datenkanal, wie es Chrome und Safari erzeugen. */
export function buildSdp(p: PackedSdp): string {
  const hex = Array.from(p.fingerprint, (x) => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
  const cands = p.candidates.map((c, i) => {
    const addr = c.kind === 'ip' ? c.ip : `${c.id.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5')}.local`;
    const priority = 2122260223 - i * 256;
    return `a=candidate:${i + 1} 1 udp ${priority} ${addr} ${c.port} typ host generation 0`;
  });
  return [
    'v=0',
    'o=- 1 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    `a=ice-ufrag:${p.ufrag}`,
    `a=ice-pwd:${p.pwd}`,
    `a=fingerprint:sha-256 ${hex}`,
    `a=setup:${p.type === 'offer' ? 'actpass' : 'active'}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    ...cands,
    'a=end-of-candidates',
    '',
  ].join('\r\n');
}

export const compressSdp = (sdp: string, type: 'offer' | 'answer') => packSdp(parseSdp(sdp, type));

export function expandSdp(code: string): { type: 'offer' | 'answer'; sdp: string } {
  const p = unpackSdpFields(code);
  return { type: p.type, sdp: buildSdp(p) };
}
