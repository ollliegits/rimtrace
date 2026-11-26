import { compressSdp, decode, encode, expandSdp, type Message } from '../../core';

export type LinkState = 'neu' | 'wartet' | 'verbindet' | 'verbunden' | 'getrennt' | 'fehler';

const gatherTimeoutMs = 4000;

/**
 * WebRTC-Datenkanal ohne Vermittlungsserver: Offer und Answer werden als kurze Codes (QR/Text) ausgetauscht.
 * Ohne ICE-Server funktioniert das nur im selben lokalen Netz.
 */
export class Link {
  private pc: RTCPeerConnection;
  private channel?: RTCDataChannel;
  state: LinkState = 'neu';
  detail = '';
  onMessage: (m: Message) => void = () => {};
  onState: (s: LinkState, detail: string) => void = () => {};
  onProblem: (text: string) => void = () => {};

  constructor() {
    this.pc = new RTCPeerConnection({ iceServers: [] });
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'connected') this.set('verbunden');
      else if (s === 'connecting') this.set('verbindet');
      else if (s === 'failed') this.set('fehler', 'Verbindung fehlgeschlagen (gleiches WLAN? Gästenetz mit Geräteisolation?)');
      else if (s === 'disconnected' || s === 'closed') this.set('getrennt');
    };
  }

  private set(state: LinkState, detail = ''): void {
    this.state = state;
    this.detail = detail;
    this.onState(state, detail);
  }

  private wire(ch: RTCDataChannel): void {
    this.channel = ch;
    ch.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      const r = decode(e.data);
      if ('error' in r) this.onProblem(r.error);
      else this.onMessage(r.message);
    };
    ch.onclose = () => this.set('getrennt');
  }

  send(m: Message): boolean {
    if (this.channel?.readyState !== 'open') return false;
    this.channel.send(encode(m));
    return true;
  }

  get bufferedAmount(): number {
    return this.channel?.bufferedAmount ?? 0;
  }

  private async gathered(): Promise<string> {
    if (this.pc.iceGatheringState !== 'complete') {
      await new Promise<void>((resolve) => {
        const done = () => {
          if (this.pc.iceGatheringState === 'complete') resolve();
        };
        this.pc.addEventListener('icegatheringstatechange', done);
        setTimeout(resolve, gatherTimeoutMs);
      });
    }
    return this.pc.localDescription!.sdp;
  }

  /** Steuerung: Offer erzeugen, Code für den QR-Code liefern. */
  async createOffer(): Promise<string> {
    this.wire(this.pc.createDataChannel('rimtrace'));
    await this.pc.setLocalDescription(await this.pc.createOffer());
    this.set('wartet');
    return compressSdp(await this.gathered(), 'offer');
  }

  /** Kamera: Offer-Code annehmen, Answer-Code liefern. */
  async acceptOffer(code: string): Promise<string> {
    const { type, sdp } = expandSdp(code);
    if (type !== 'offer') throw new Error('Das ist kein Offer-Code');
    this.pc.ondatachannel = (e) => this.wire(e.channel);
    await this.pc.setRemoteDescription({ type, sdp });
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    this.set('verbindet');
    return compressSdp(await this.gathered(), 'answer');
  }

  /** Steuerung: Answer-Code des Handys annehmen. */
  async acceptAnswer(code: string): Promise<void> {
    const { type, sdp } = expandSdp(code);
    if (type !== 'answer') throw new Error('Das ist kein Answer-Code');
    await this.pc.setRemoteDescription({ type, sdp });
    this.set('verbindet');
  }

  /** Gewähltes Kandidatenpaar, z. B. "host/host udp 192.168.1.5:50000 ↔ 192.168.1.7:61234". */
  async candidatePair(): Promise<string> {
    const stats = await this.pc.getStats();
    const byId = new Map<string, Record<string, unknown>>();
    stats.forEach((s) => byId.set(s.id, s));
    for (const s of byId.values()) {
      if (s.type !== 'candidate-pair' || !(s.nominated || s.state === 'succeeded')) continue;
      const l = byId.get(s.localCandidateId as string);
      const r = byId.get(s.remoteCandidateId as string);
      if (!l || !r) continue;
      const fmt = (c: Record<string, unknown>) => `${String(c.address ?? c.ip)}:${String(c.port)}`;
      return `${String(l.candidateType)}/${String(r.candidateType)} ${String(l.protocol)} ${fmt(l)} ↔ ${fmt(r)}`;
    }
    return 'unbekannt';
  }

  close(): void {
    this.channel?.close();
    this.pc.close();
  }
}
