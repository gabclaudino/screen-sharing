// Fakes de WebRTC só para testes: simulam a máquina de estados de signaling do
// RTCPeerConnection (offer/answer, rollback implícito, negotiationneeded) com SDPs que
// carregam a lista de tracks enviadas, o suficiente para testar Perfect Negotiation
// entre dois PeerManagers sem um navegador.

export interface FakeTrack {
  id: string;
  kind: 'audio' | 'video';
}

type Listener = () => void;

export class FakeStream {
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(
    readonly id: string,
    private tracks: FakeTrack[] = [],
  ) {}

  getTracks(): FakeTrack[] {
    return [...this.tracks];
  }

  addEventListener(type: string, listener: Listener): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  addTrack(track: FakeTrack): void {
    this.tracks.push(track);
  }

  removeTrack(track: FakeTrack): void {
    this.tracks = this.tracks.filter((t) => t.id !== track.id);
    this.listeners.get('removetrack')?.forEach((listener) => listener());
  }
}

export class FakeSender {
  track: FakeTrack | null = null;
  streamId: string | null = null;
  params: { encodings: { maxBitrate?: number }[] } = { encodings: [] };
  setParametersCalls: (number | undefined)[] = [];

  getParameters() {
    return this.params;
  }

  setParameters(params: { encodings: { maxBitrate?: number }[] }): Promise<void> {
    this.params = params;
    this.setParametersCalls.push(params.encodings[0]?.maxBitrate);
    return Promise.resolve();
  }
}

interface FakeTransceiver {
  kind: 'audio' | 'video';
  sender: FakeSender;
}

type SignalingState = 'stable' | 'have-local-offer' | 'have-remote-offer';

interface FakeDescription {
  type: 'offer' | 'answer' | 'rollback';
  sdp?: string;
}

export class FakeIceCandidate {
  constructor(readonly candidate = 'candidate:1 1 udp 1 1.2.3.4 5 typ host') {}
  sdpMid = '0';
  sdpMLineIndex = 0;
  usernameFragment = 'ufrag';
}

export class FakePeerConnection {
  signalingState: SignalingState = 'stable';
  connectionState: 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed' =
    'new';
  localDescription: FakeDescription | null = null;
  remoteDescription: FakeDescription | null = null;
  closed = false;
  restartIceCalls = 0;
  dataChannels: { label: string; init: unknown }[] = [];
  transceivers: FakeTransceiver[] = [];
  statsReports: Record<string, unknown>[] = [];
  addedCandidates: unknown[] = [];

  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((event: { candidate: FakeIceCandidate | null }) => void) | null = null;
  ontrack: ((event: { track: FakeTrack; streams: FakeStream[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  onsignalingstatechange: (() => void) | null = null;

  private needsNegotiation = false;
  private sdpCounter = 0;
  private readonly remoteTracks = new Map<string, { track: FakeTrack; stream: FakeStream }>();
  private readonly remoteStreams = new Map<string, FakeStream>();

  constructor(readonly config: unknown) {}

  createDataChannel(label: string, init: unknown): object {
    this.dataChannels.push({ label, init });
    this.scheduleNegotiation();
    return {};
  }

  addTransceiver(kind: 'audio' | 'video'): FakeTransceiver {
    const transceiver = { kind, sender: new FakeSender() };
    this.transceivers.push(transceiver);
    this.scheduleNegotiation();
    return transceiver;
  }

  addTrack(track: FakeTrack, stream: FakeStream): FakeSender {
    // Como no navegador: reaproveita um transceiver do mesmo tipo cujo sender está livre.
    const reusable = this.transceivers.find(
      (t) => t.kind === track.kind && t.sender.track === null,
    );
    const transceiver = reusable ?? this.addTransceiver(track.kind);
    transceiver.sender.track = track;
    transceiver.sender.streamId = stream.id;
    this.scheduleNegotiation();
    return transceiver.sender;
  }

  removeTrack(sender: FakeSender): void {
    sender.track = null;
    sender.streamId = null;
    this.scheduleNegotiation();
  }

  getSenders(): FakeSender[] {
    return this.transceivers.map((t) => t.sender);
  }

  // Como no navegador, set*Description e addIceCandidate rodam numa fila de operações, em ordem,
  // e o tipo implícito de setLocalDescription() é decidido no momento da execução.
  private chain: Promise<unknown> = Promise.resolve();

  private enqueue<T>(operation: () => T): Promise<T> {
    const result = this.chain.then(operation);
    this.chain = result.catch(() => undefined);
    return result;
  }

  setLocalDescription(description?: FakeDescription): Promise<void> {
    return this.enqueue(() => {
      const type =
        description?.type ?? (this.signalingState === 'have-remote-offer' ? 'answer' : 'offer');
      if (type === 'answer' && this.signalingState !== 'have-remote-offer') {
        throw new Error('InvalidStateError: answer sem offer remota');
      }
      this.localDescription = { type, sdp: this.currentSdp() };
      this.setSignalingState(type === 'offer' ? 'have-local-offer' : 'stable');
      // setLocalDescription de uma offer inicia a coleta de candidates.
      if (type === 'offer') {
        // A coleta é assíncrona: os candidates saem depois de a offer já ter sido enviada.
        let hops = 12;
        const emit = (): void => {
          if (--hops > 0) queueMicrotask(emit);
          else this.onicecandidate?.({ candidate: new FakeIceCandidate() });
        };
        queueMicrotask(emit);
      }
    });
  }

  setRemoteDescription(description: FakeDescription): Promise<void> {
    return this.enqueue(() => {
      if (description.type === 'answer' && this.signalingState !== 'have-local-offer') {
        throw new Error('InvalidStateError: answer sem offer local');
      }
      // Offer remota em have-local-offer faz rollback implícito da offer local.
      this.remoteDescription = description;
      this.applyRemoteTracks(description.sdp);
      this.setSignalingState(description.type === 'offer' ? 'have-remote-offer' : 'stable');
    });
  }

  addIceCandidate(candidate: unknown): Promise<void> {
    return this.enqueue(() => {
      if (!this.remoteDescription) throw new Error('InvalidStateError: sem remoteDescription');
      this.addedCandidates.push(candidate);
    });
  }

  restartIce(): void {
    this.restartIceCalls += 1;
    this.scheduleNegotiation();
  }

  getStats(): Promise<{ forEach: (cb: (report: Record<string, unknown>) => void) => void }> {
    const reports = this.statsReports;
    return Promise.resolve({ forEach: (cb) => reports.forEach((report) => cb(report)) });
  }

  close(): void {
    this.closed = true;
    this.connectionState = 'closed';
  }

  // --- controles dos testes ---

  setConnectionState(state: FakePeerConnection['connectionState']): void {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }

  /** Reports para getStats(): um par selecionado com candidates locais/remotos dos tipos dados. */
  setSelectedPair(local: 'host' | 'srflx' | 'relay', remote: 'host' | 'srflx' | 'relay'): void {
    this.statsReports = [
      { id: 'T', type: 'transport', selectedCandidatePairId: 'P' },
      { id: 'P', type: 'candidate-pair', localCandidateId: 'L', remoteCandidateId: 'R' },
      { id: 'L', type: 'local-candidate', candidateType: local },
      { id: 'R', type: 'remote-candidate', candidateType: remote },
    ];
  }

  // --- internos ---

  private currentSdp(): string {
    const tracks = this.transceivers
      .filter((t) => t.sender.track !== null)
      .map((t) => ({ ...t.sender.track, streamId: t.sender.streamId }));
    return JSON.stringify({ n: ++this.sdpCounter, tracks });
  }

  private applyRemoteTracks(sdp: string | undefined): void {
    if (!sdp) return;
    const { tracks } = JSON.parse(sdp) as { tracks: (FakeTrack & { streamId: string })[] };
    const present = new Set(tracks.map((t) => t.id));

    for (const info of tracks) {
      if (this.remoteTracks.has(info.id)) continue;
      let stream = this.remoteStreams.get(info.streamId);
      if (!stream) {
        stream = new FakeStream(info.streamId, []);
        this.remoteStreams.set(info.streamId, stream);
      }
      const track = { id: info.id, kind: info.kind };
      // O stream remoto passa a conter a track antes do evento, como no navegador.
      stream.addTrack(track);
      this.remoteTracks.set(info.id, { track, stream });
      this.ontrack?.({ track, streams: [stream] });
    }
    for (const [id, { track, stream }] of [...this.remoteTracks]) {
      if (present.has(id)) continue;
      this.remoteTracks.delete(id);
      stream.removeTrack(track);
    }
  }

  private scheduleNegotiation(): void {
    this.needsNegotiation = true;
    queueMicrotask(() => this.fireNegotiationIfNeeded());
  }

  private fireNegotiationIfNeeded(): void {
    if (!this.needsNegotiation || this.closed || this.signalingState !== 'stable') return;
    this.needsNegotiation = false;
    this.onnegotiationneeded?.();
  }

  private setSignalingState(state: SignalingState): void {
    this.signalingState = state;
    if (state === 'stable') {
      // Depois de uma negociação concluída, os senders ganham `encodings`.
      for (const t of this.transceivers) {
        if (t.sender.track && t.sender.params.encodings.length === 0) {
          t.sender.params.encodings = [{}];
        }
      }
    }
    this.onsignalingstatechange?.();
    if (state === 'stable') queueMicrotask(() => this.fireNegotiationIfNeeded());
  }
}
