import type { PeerInfo, SignalData } from '@screenshare/shared';
import { TypedEmitter } from './emitter';
import { PeerLink, type PeerStatus } from './peer-link';

export type { PeerStatus } from './peer-link';

export interface PeerManagerEvents {
  /** Stream recebido de um peer; `null` quando ele parou de enviar. */
  'remote-stream': { peerId: string; stream: MediaStream | null };
  status: { peerId: string; status: PeerStatus };
}

export interface PeerManagerOptions {
  /** Envia `signal` pelo WS; `false` se não houver conexão (a mensagem é descartada). */
  sendSignal: (to: string, data: SignalData) => boolean;
  /** iceServers atuais (STUN/TURN); lido a cada conexão criada. */
  getIceServers: () => RTCIceServer[];
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
  maxBitrate?: number;
  /** Tempo em disconnected/failed antes de recriar a conexão (padrão 10 s). */
  brokenTimeoutMs?: number;
  statsIntervalMs?: number;
}

const DEFAULT_MAX_BITRATE = 2_500_000;

const defaultCreatePeerConnection = (config: RTCConfiguration): RTCPeerConnection =>
  new RTCPeerConnection(config);

/**
 * Mesh WebRTC: uma `PeerLink` por peer da sala (N·(N−1)/2 conexões no total). Classe pura,
 * sem React; os hooks só a ligam à UI e ao SignalingClient.
 */
export class PeerManager extends TypedEmitter<PeerManagerEvents> {
  private readonly opts: PeerManagerOptions;
  private readonly links = new Map<string, PeerLink>();
  private selfId: string | null = null;
  private localStream: MediaStream | null = null;
  private maxBitrate: number;

  constructor(options: PeerManagerOptions) {
    super();
    this.opts = options;
    this.maxBitrate = options.maxBitrate ?? DEFAULT_MAX_BITRATE;
  }

  get peerIds(): string[] {
    return [...this.links.keys()];
  }

  /**
   * Chamar a cada `joined` (inclusive após reconexão do WS): o `selfId` mudou, então todas as
   * conexões antigas são descartadas e uma nova é criada para cada peer já presente.
   */
  setSelf(selfId: string, peers: PeerInfo[]): void {
    this.closeAll();
    this.selfId = selfId;
    for (const peer of peers) this.addPeer(peer);
  }

  addPeer(peer: Pick<PeerInfo, 'id'>): void {
    this.requireSelf();
    this.dropLink(peer.id);
    this.links.set(peer.id, this.createLink(peer.id, 0));
  }

  removePeer(peerId: string): void {
    this.dropLink(peerId);
  }

  handleSignal(from: string, data: SignalData): void {
    let link = this.links.get(from);
    if (!link) {
      console.warn('[peers] signal de peer desconhecido ignorado');
      return;
    }
    if (data.gen < link.gen) return; // mensagem de uma conexão já descartada

    if (data.gen > link.gen) {
      // O outro lado recriou a conexão (o `reset` normalmente chega antes, mas qualquer
      // mensagem de geração maior tem o mesmo efeito): acompanhamos a geração dele.
      link = this.recreate(from, data.gen);
    }
    if (!link || data.reset) return; // `reset` com gen igual: já estamos sincronizados
    void link.handleSignal(data);
  }

  /** Começa a enviar este stream a todos os peers (e aos que entrarem depois); `null` para. */
  setLocalStream(stream: MediaStream | null): void {
    this.localStream = stream;
    for (const link of this.links.values()) link.setLocalStream(stream);
  }

  setMaxBitrate(bitsPerSecond: number): void {
    this.maxBitrate = bitsPerSecond;
    for (const link of this.links.values()) void link.applyBitrate();
  }

  closeAll(): void {
    for (const peerId of [...this.links.keys()]) this.dropLink(peerId);
  }

  // -------------------------------------------------------------------------

  private requireSelf(): string {
    if (this.selfId === null) throw new Error('PeerManager: chame setSelf() antes de addPeer()');
    return this.selfId;
  }

  private createLink(peerId: string, gen: number): PeerLink {
    const selfId = this.requireSelf();
    const createPc = this.opts.createPeerConnection ?? defaultCreatePeerConnection;
    const link: PeerLink = new PeerLink({
      peerId,
      // Comparação de strings: determinística e igual nos dois lados.
      polite: selfId < peerId,
      gen,
      pc: createPc({ iceServers: this.opts.getIceServers() }),
      sendSignal: (data) => {
        if (!this.opts.sendSignal(peerId, data)) {
          // Sem WS não há como renegociar; a recuperação vem do restartIce/recriação.
          console.warn('[peers] signal descartado: sinalização indisponível');
        }
      },
      onStatus: (status) => {
        if (this.links.get(peerId) === link) this.emit('status', { peerId, status });
      },
      onRemoteStream: (stream) => {
        if (this.links.get(peerId) === link) this.emit('remote-stream', { peerId, stream });
      },
      onBroken: () => {
        if (this.links.get(peerId) === link) this.recreate(peerId);
      },
      getMaxBitrate: () => this.maxBitrate,
      brokenTimeoutMs: this.opts.brokenTimeoutMs ?? 10_000,
      statsIntervalMs: this.opts.statsIntervalMs ?? 5_000,
    });
    if (this.localStream) link.setLocalStream(this.localStream);
    return link;
  }

  /**
   * Descarta a conexão e cria outra. Sem `forcedGen` a iniciativa é nossa: incrementa a geração
   * e avisa o peer com `reset`. Com `forcedGen`, estamos apenas seguindo o peer.
   */
  private recreate(peerId: string, forcedGen?: number): PeerLink | undefined {
    const old = this.links.get(peerId);
    if (!old) return undefined;

    const gen = forcedGen ?? old.gen + 1;
    const hadStream = old.hasRemoteStream;
    this.links.delete(peerId);
    old.close();
    if (hadStream) this.emit('remote-stream', { peerId, stream: null });

    const link = this.createLink(peerId, gen);
    this.links.set(peerId, link);
    this.emit('status', { peerId, status: 'connecting' });
    // O reset sai antes da offer da nova conexão (que só é criada em microtask posterior).
    if (forcedGen === undefined) this.opts.sendSignal(peerId, { gen, reset: true });
    return link;
  }

  private dropLink(peerId: string): void {
    const link = this.links.get(peerId);
    if (!link) return;
    this.links.delete(peerId);
    link.close();
    if (link.hasRemoteStream) this.emit('remote-stream', { peerId, stream: null });
  }
}
