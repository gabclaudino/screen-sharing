import type { SignalData } from '@screenshare/shared';

/** Estado de conexão com um peer, como mostrado na UI. */
export type PeerStatus = 'connecting' | 'p2p' | 'relay' | 'failed';

export interface PeerLinkDeps {
  peerId: string;
  /** Peer "educado" do Perfect Negotiation: cede em colisão de offers. */
  polite: boolean;
  /** Geração desta conexão; vai em todo `signal` para descartar mensagens de conexões antigas. */
  gen: number;
  pc: RTCPeerConnection;
  sendSignal: (data: SignalData) => void;
  onStatus: (status: PeerStatus) => void;
  /** `null` quando o peer parou de enviar mídia. */
  onRemoteStream: (stream: MediaStream | null) => void;
  /** A conexão não se recupera sozinha: o dono deve recriá-la. */
  onBroken: () => void;
  getMaxBitrate: () => number;
  /** Tempo em `disconnected`/`failed` antes de pedir recriação. */
  brokenTimeoutMs: number;
  /** Período do getStats() para detectar P2P vs relay; 0 desativa a repetição. */
  statsIntervalMs: number;
}

/**
 * Lê o par de candidates selecionado e diz se o tráfego passa por TURN (`relay`) ou é direto.
 * `null` quando ainda não há par selecionado.
 */
export function detectConnectionType(stats: RTCStatsReport): 'p2p' | 'relay' | null {
  const byId = new Map<string, Record<string, unknown>>();
  const pairs: Record<string, unknown>[] = [];
  let selectedPairId: unknown;

  stats.forEach((report: Record<string, unknown>) => {
    byId.set(String(report.id), report);
    if (report.type === 'transport' && report.selectedCandidatePairId !== undefined) {
      selectedPairId = report.selectedCandidatePairId;
    } else if (report.type === 'candidate-pair') {
      pairs.push(report);
    }
  });

  // Chrome expõe o par em `transport`; Firefox só marca `selected`/`nominated` no próprio par.
  const pair =
    (selectedPairId === undefined ? undefined : byId.get(String(selectedPairId))) ??
    pairs.find((p) => p.selected === true || (p.nominated === true && p.state === 'succeeded'));
  if (!pair) return null;

  const local = byId.get(String(pair.localCandidateId));
  const remote = byId.get(String(pair.remoteCandidateId));
  if (!local && !remote) return null;
  return local?.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'relay' : 'p2p';
}

/**
 * Uma `RTCPeerConnection` com um peer, usando Perfect Negotiation (MDN/W3C):
 * colisões de offer são resolvidas pelo lado polite com rollback implícito.
 */
export class PeerLink {
  readonly gen: number;
  private readonly pc: RTCPeerConnection;
  private readonly deps: PeerLinkDeps;

  // Estado do Perfect Negotiation
  private makingOffer = false;
  private ignoreOffer = false;
  private settingRemoteAnswer = false;

  private closed = false;
  private status: PeerStatus = 'connecting';
  private iceRestarted = false;
  private localStream: MediaStream | null = null;
  private senders: RTCRtpSender[] = [];
  private remoteStream: MediaStream | null = null;
  private brokenTimer: ReturnType<typeof setTimeout> | undefined;
  private statsTimer: ReturnType<typeof setInterval> | undefined;

  constructor(deps: PeerLinkDeps) {
    this.deps = deps;
    this.gen = deps.gen;
    this.pc = deps.pc;
    const pc = this.pc;

    // Handlers primeiro: os passos abaixo disparam `negotiationneeded`.
    pc.onnegotiationneeded = () => void this.negotiate();
    pc.onicecandidate = (event) => {
      // `candidate` nulo marca o fim da coleta; não há nada a enviar.
      const c = event.candidate;
      if (c) {
        this.send({
          candidate: {
            candidate: c.candidate,
            sdpMid: c.sdpMid,
            sdpMLineIndex: c.sdpMLineIndex,
            usernameFragment: c.usernameFragment,
          },
        });
      }
    };
    pc.ontrack = (event) => this.handleTrack(event);
    pc.onconnectionstatechange = () => this.handleConnectionState();
    pc.onsignalingstatechange = () => {
      if (pc.signalingState === 'stable') void this.applyBitrate();
    };

    // Uma conexão sem tracks nem data channel nunca dispararia `negotiationneeded`. O canal
    // pré-negociado (mesmo id nos dois lados) e o transceiver recvonly fazem a conexão subir
    // assim que o par se conhece, e já deixam uma m-line de vídeo pronta para receber/enviar.
    pc.createDataChannel('ctrl', { negotiated: true, id: 0 });
    pc.addTransceiver('video', { direction: 'recvonly' });

    if (deps.statsIntervalMs > 0) {
      this.statsTimer = setInterval(() => void this.refreshConnectionType(), deps.statsIntervalMs);
    }
  }

  get hasRemoteStream(): boolean {
    return this.remoteStream !== null;
  }

  /** Começa (ou, com `null`, para) de enviar o stream local para este peer. */
  setLocalStream(stream: MediaStream | null): void {
    if (this.closed || stream === this.localStream) return;

    for (const sender of this.senders) {
      try {
        this.pc.removeTrack(sender);
      } catch (error) {
        console.warn('[peer] removeTrack falhou:', error);
      }
    }
    this.senders = [];
    this.localStream = stream;

    // addTrack reaproveita o transceiver recvonly de vídeo e dispara a renegociação.
    for (const track of stream?.getTracks() ?? []) {
      this.senders.push(this.pc.addTrack(track, stream as MediaStream));
    }
  }

  /** Limita o bitrate de vídeo. `encodings` só existe depois da negociação; antes disso, ignora. */
  async applyBitrate(): Promise<void> {
    if (this.closed) return;
    const maxBitrate = this.deps.getMaxBitrate();
    for (const sender of this.senders) {
      if (sender.track?.kind !== 'video') continue;
      try {
        const params = sender.getParameters();
        const encodings = params.encodings;
        if (!encodings || encodings.length === 0) continue;
        if (encodings.every((encoding) => encoding.maxBitrate === maxBitrate)) continue;
        for (const encoding of encodings) encoding.maxBitrate = maxBitrate;
        await sender.setParameters(params);
      } catch (error) {
        console.warn('[peer] setParameters falhou:', error);
      }
    }
  }

  async handleSignal(data: SignalData): Promise<void> {
    if (this.closed) return;
    const pc = this.pc;
    try {
      if (data.description) {
        const description = data.description;
        const readyForOffer =
          !this.makingOffer && (pc.signalingState === 'stable' || this.settingRemoteAnswer);
        const offerCollision = description.type === 'offer' && !readyForOffer;

        // Impolite ignora a offer do outro lado e espera a sua própria ser respondida;
        // polite aceita (setRemoteDescription faz rollback implícito da própria offer).
        this.ignoreOffer = !this.deps.polite && offerCollision;
        if (this.ignoreOffer) return;

        this.settingRemoteAnswer = description.type === 'answer';
        await pc.setRemoteDescription(description);
        this.settingRemoteAnswer = false;

        if (description.type === 'offer') {
          await pc.setLocalDescription();
          this.sendLocalDescription();
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (error) {
          // Candidates de uma offer ignorada falham de propósito.
          if (!this.ignoreOffer) throw error;
        }
      }
    } catch (error) {
      console.error(`[peer ${this.deps.peerId}] erro tratando signal:`, error);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.brokenTimer);
    clearInterval(this.statsTimer);
    const pc = this.pc;
    pc.onnegotiationneeded = null;
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onconnectionstatechange = null;
    pc.onsignalingstatechange = null;
    pc.close();
  }

  // -------------------------------------------------------------------------

  private send(part: Pick<SignalData, 'description' | 'candidate'>): void {
    if (!this.closed) this.deps.sendSignal({ gen: this.gen, ...part });
  }

  private sendLocalDescription(): void {
    const description = this.pc.localDescription;
    if (description) this.send({ description: { type: description.type, sdp: description.sdp } });
  }

  private async negotiate(): Promise<void> {
    if (this.closed) return;
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      this.sendLocalDescription();
    } catch (error) {
      console.error(`[peer ${this.deps.peerId}] erro criando offer:`, error);
    } finally {
      this.makingOffer = false;
    }
  }

  private handleTrack(event: RTCTrackEvent): void {
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    if (this.remoteStream === stream) return;
    this.remoteStream = stream;
    this.deps.onRemoteStream(stream);

    // O peer parou de compartilhar quando todas as tracks saem do stream.
    stream.addEventListener('removetrack', () => {
      if (this.remoteStream === stream && stream.getTracks().length === 0) {
        this.remoteStream = null;
        this.deps.onRemoteStream(null);
      }
    });
  }

  private setStatus(status: PeerStatus): void {
    if (this.closed || this.status === status) return;
    this.status = status;
    this.deps.onStatus(status);
  }

  private handleConnectionState(): void {
    clearTimeout(this.brokenTimer);
    switch (this.pc.connectionState) {
      case 'connected':
        this.iceRestarted = false;
        this.setStatus('connecting'); // até saber se é P2P ou relay
        void this.refreshConnectionType();
        return;
      case 'disconnected':
        // Costuma se curar sozinho; só recria se persistir.
        this.brokenTimer = setTimeout(() => this.deps.onBroken(), this.deps.brokenTimeoutMs);
        return;
      case 'failed':
        this.setStatus('failed');
        if (!this.iceRestarted) {
          this.iceRestarted = true;
          this.pc.restartIce(); // dispara negotiationneeded com iceRestart
        }
        this.brokenTimer = setTimeout(() => this.deps.onBroken(), this.deps.brokenTimeoutMs);
        return;
      case 'new':
      case 'connecting':
        if (this.status === 'failed') this.setStatus('connecting');
        return;
      case 'closed':
        return;
    }
  }

  private async refreshConnectionType(): Promise<void> {
    if (this.closed || this.pc.connectionState !== 'connected') return;
    try {
      const type = detectConnectionType(await this.pc.getStats());
      if (type && !this.closed && this.pc.connectionState === 'connected') this.setStatus(type);
    } catch (error) {
      console.warn('[peer] getStats falhou:', error);
    }
  }
}
