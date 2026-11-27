import type { CandidateCounts, ConnectionReport, SignalData } from '@screenshare/shared';
import { downscaleFactor } from './capture';

/** Relato de diagnóstico de uma conexão (o dono completa quem relata e sobre quem). */
export type LinkReport = Omit<ConnectionReport, 'self' | 'peer'>;

/** Momentos (ms desde a criação) em que uma conexão ainda não estabelecida é relatada. */
export const SLOW_REPORT_MS: readonly number[] = [15_000, 60_000];
/** Desfazer uma conexão mais nova que isto não é relatado (entrada e saída normais). */
const ABANDONED_MIN_MS = 3_000;
/** Teto por conexão, para um ciclo de falhas não encher o log. */
const MAX_REPORTS_PER_LINK = 12;

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
  /** Detalhes do caminho (tipos de candidate, protocolo do relay); só quando mudam. */
  onConnection?: (info: ConnectionInfo) => void;
  /** `null` quando o peer parou de enviar mídia. */
  onRemoteStream: (stream: MediaStream | null) => void;
  /** A conexão não se recupera sozinha: o dono deve recriá-la. */
  onBroken: () => void;
  /** Relato para o log do servidor. */
  onReport?: (report: LinkReport) => void;
  /** Há servidor TURN entre os iceServers desta conexão. */
  hasTurn?: boolean;
  getMaxBitrate: () => number;
  /** Tempo em `disconnected`/`failed` antes de pedir recriação. */
  brokenTimeoutMs: number;
  /** Prazo para uma tentativa conectar antes de pedir recriação; 0 desativa. */
  connectTimeoutMs: number;
  /** Período do getStats() para detectar P2P vs relay; 0 desativa a repetição. */
  statsIntervalMs: number;
}

/** Tipo de um candidate ICE (de onde vem o endereço). */
export type CandidateKind = 'host' | 'srflx' | 'prflx' | 'relay' | 'unknown';

/** Por onde a conexão com um peer realmente passa (lido do par de candidates selecionado). */
export interface ConnectionInfo {
  type: 'p2p' | 'relay';
  /** Nosso candidate e o do peer. `host` = rede local/IPv6 direto, `srflx` = via STUN, `relay` = TURN. */
  local: CandidateKind;
  remote: CandidateKind;
  /** Protocolo do relay quando NOSSO lado usa TURN (`tcp`/`tls` costumam piorar o vídeo). */
  relayProtocol: 'udp' | 'tcp' | 'tls' | null;
  /** O endereço do nosso lado é IPv6. */
  ipv6: boolean;
}

const CANDIDATE_KINDS: readonly CandidateKind[] = ['host', 'srflx', 'prflx', 'relay'];
const noCandidates = (): CandidateCounts => ({ host: 0, srflx: 0, prflx: 0, relay: 0 });
/** Conta o tipo (`typ xxx`) de um candidate; o endereço é ignorado. */
function countCandidate(counts: CandidateCounts, candidate: string): void {
  const kind = / typ (host|srflx|prflx|relay)\b/.exec(candidate)?.[1];
  if (kind) counts[kind as keyof CandidateCounts] += 1;
}
const asKind = (value: unknown): CandidateKind =>
  CANDIDATE_KINDS.find((kind) => kind === value) ?? 'unknown';

/**
 * Lê o par de candidates selecionado e descreve o caminho: P2P ou relay (TURN), os tipos de
 * candidate dos dois lados e o protocolo do relay. `null` quando ainda não há par selecionado.
 */
export function describeConnection(stats: RTCStatsReport): ConnectionInfo | null {
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

  const localKind = asKind(local?.candidateType);
  const remoteKind = asKind(remote?.candidateType);
  const relayProtocol = localKind === 'relay' ? local?.relayProtocol : undefined;
  const address = local?.address ?? local?.ip;
  return {
    type: localKind === 'relay' || remoteKind === 'relay' ? 'relay' : 'p2p',
    local: localKind,
    remote: remoteKind,
    relayProtocol:
      relayProtocol === 'udp' || relayProtocol === 'tcp' || relayProtocol === 'tls'
        ? relayProtocol
        : null,
    ipv6: typeof address === 'string' && address.includes(':'),
  };
}

/** Só o tipo (P2P ou relay) do par selecionado; `null` quando ainda não há par. */
export function detectConnectionType(stats: RTCStatsReport): 'p2p' | 'relay' | null {
  return describeConnection(stats)?.type ?? null;
}

const errorName = (error: unknown): string => {
  const name = error instanceof Error ? error.name : '';
  return /^[A-Za-z]{1,40}$/.test(name) ? name : 'Error';
};

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
  private connectTimer: ReturnType<typeof setTimeout> | undefined;
  private statsTimer: ReturnType<typeof setInterval> | undefined;
  private lastConnection = '';

  // Diagnóstico
  private readonly createdAt = Date.now();
  private readonly sent = noCandidates();
  private readonly received = noCandidates();
  private readonly iceErrors = new Set<number>();
  private slowTimers: ReturnType<typeof setTimeout>[] = [];
  private everConnected = false;
  private connectedReported = false;
  private reports = 0;
  private readonly reportedErrors = new Set<string>();

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
        countCandidate(this.sent, c.candidate);
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
    pc.onicecandidateerror = (event) => this.iceErrors.add(event.errorCode);
    pc.onconnectionstatechange = () => this.handleConnectionState();
    pc.onsignalingstatechange = () => {
      if (pc.signalingState === 'stable') void this.applyBitrate();
    };

    // Uma conexão sem tracks nem data channel nunca dispararia `negotiationneeded`. O canal
    // pré-negociado (mesmo id nos dois lados) e o transceiver recvonly fazem a conexão subir
    // assim que o par se conhece, e já deixam uma m-line de vídeo pronta para receber/enviar.
    pc.createDataChannel('ctrl', { negotiated: true, id: 0 });
    pc.addTransceiver('video', { direction: 'recvonly' });

    this.slowTimers = SLOW_REPORT_MS.map((delay) =>
      setTimeout(() => {
        if (!this.everConnected) this.report('slow');
      }, delay),
    );

    this.armConnectTimeout();

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

  /**
   * Limita o vídeo enviado: bitrate máximo e resolução máxima (1080p). `encodings` só existe depois
   * da negociação; antes disso, ignora. A captura já é pedida reduzida; aqui é a rede de segurança
   * para navegadores que ignoram o limite da captura.
   */
  async applyBitrate(): Promise<void> {
    if (this.closed) return;
    const maxBitrate = this.deps.getMaxBitrate();
    for (const sender of this.senders) {
      if (sender.track?.kind !== 'video') continue;
      try {
        const params = sender.getParameters();
        const encodings = params.encodings;
        if (!encodings || encodings.length === 0) continue;
        const settings = sender.track.getSettings?.();
        const scale = downscaleFactor(settings?.width, settings?.height);
        const upToDate = encodings.every(
          (encoding) =>
            encoding.maxBitrate === maxBitrate && (encoding.scaleResolutionDownBy ?? 1) === scale,
        );
        if (upToDate) continue;
        for (const encoding of encodings) {
          encoding.maxBitrate = maxBitrate;
          // Só grava a escala quando é preciso reduzir (ou desfazer uma redução antiga).
          if (scale > 1 || encoding.scaleResolutionDownBy !== undefined) {
            encoding.scaleResolutionDownBy = scale;
          }
        }
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
        countCandidate(this.received, data.candidate.candidate);
        try {
          await pc.addIceCandidate(data.candidate);
        } catch (error) {
          // Candidates de uma offer ignorada falham de propósito.
          if (!this.ignoreOffer) throw error;
        }
      }
    } catch (error) {
      console.error(`[peer ${this.deps.peerId}] erro tratando signal:`, error);
      this.reportError(error);
    }
  }

  /** A conexão vai ser desfeita sem nunca ter funcionado (F5 ou saída de um dos lados). */
  reportAbandoned(): void {
    if (!this.everConnected && Date.now() - this.createdAt >= ABANDONED_MIN_MS) {
      this.report('abandoned');
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.brokenTimer);
    clearTimeout(this.connectTimer);
    clearInterval(this.statsTimer);
    this.slowTimers.forEach((timer) => clearTimeout(timer));
    const pc = this.pc;
    pc.onnegotiationneeded = null;
    pc.onicecandidate = null;
    pc.ontrack = null;
    pc.onicecandidateerror = null;
    pc.onconnectionstatechange = null;
    pc.onsignalingstatechange = null;
    pc.close();
  }

  // -------------------------------------------------------------------------

  private report(event: LinkReport['event'], extra: Pick<LinkReport, 'path' | 'error'> = {}): void {
    if (this.closed || this.reports >= MAX_REPORTS_PER_LINK) return;
    this.reports += 1;
    const pc = this.pc;
    this.deps.onReport?.({
      event,
      gen: this.gen,
      ms: Math.max(0, Math.round(Date.now() - this.createdAt)),
      connectionState: pc.connectionState ?? 'unknown',
      iceState: pc.iceConnectionState ?? 'unknown',
      gatheringState: pc.iceGatheringState ?? 'unknown',
      signalingState: pc.signalingState ?? 'unknown',
      remoteDescription: Boolean(pc.remoteDescription),
      sent: { ...this.sent },
      received: { ...this.received },
      iceErrors: [...this.iceErrors].filter((code) => code >= 0 && code <= 999).slice(0, 8),
      turn: this.deps.hasTurn ?? false,
      ...extra,
    });
  }

  /**
   * Sem isto uma tentativa que não avança (ex.: resposta perdida) ficaria em "conectando" para
   * sempre: o navegador só declara `failed` quando a negociação chega a se completar.
   */
  private armConnectTimeout(): void {
    clearTimeout(this.connectTimer);
    if (this.deps.connectTimeoutMs <= 0) return;
    this.connectTimer = setTimeout(() => {
      if (this.pc.connectionState === 'connected') return;
      this.report('timeout');
      this.deps.onBroken();
    }, this.deps.connectTimeoutMs);
  }

  /** Cada tipo de erro uma vez: repetidos esgotariam o limite de relatos da conexão. */
  private reportError(error: unknown): void {
    const name = errorName(error);
    if (this.reportedErrors.has(name)) return;
    this.reportedErrors.add(name);
    this.report('error', { error: name });
  }

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
      this.reportError(error);
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
        this.everConnected = true;
        clearTimeout(this.connectTimer);
        this.iceRestarted = false;
        this.setStatus('connecting'); // até saber se é P2P ou relay
        void this.refreshConnectionType();
        return;
      case 'disconnected':
        // Costuma se curar sozinho; só recria se persistir.
        this.report('disconnected');
        this.brokenTimer = setTimeout(() => this.deps.onBroken(), this.deps.brokenTimeoutMs);
        return;
      case 'failed':
        this.setStatus('failed');
        this.report('failed');
        if (!this.iceRestarted) {
          this.iceRestarted = true;
          this.pc.restartIce(); // dispara negotiationneeded com iceRestart
        }
        this.brokenTimer = setTimeout(() => this.deps.onBroken(), this.deps.brokenTimeoutMs);
        return;
      case 'new':
      case 'connecting':
        if (this.status === 'failed') {
          this.setStatus('connecting');
          // Nova tentativa (restartIce) depois de uma falha: também tem prazo.
          this.armConnectTimeout();
        }
        return;
      case 'closed':
        return;
    }
  }

  private async refreshConnectionType(): Promise<void> {
    if (this.closed || this.pc.connectionState !== 'connected') return;
    try {
      const info = describeConnection(await this.pc.getStats());
      if (!info || this.closed || this.pc.connectionState !== 'connected') return;
      this.setStatus(info.type);
      if (!this.connectedReported) {
        this.connectedReported = true;
        this.report('connected', { path: info });
      }
      const key = JSON.stringify(info);
      if (key !== this.lastConnection) {
        this.lastConnection = key;
        this.deps.onConnection?.(info);
      }
    } catch (error) {
      console.warn('[peer] getStats falhou:', error);
    }
  }
}
