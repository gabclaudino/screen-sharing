import type { SignalData } from '@screenshare/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakePeerConnection, FakeStream } from './fake-webrtc';
import { PeerManager, type PeerStatus } from './peer-manager';

// ID_A < ID_B: A é "polite", B é "impolite".
const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';

const peer = (id: string) => ({ id, name: id.slice(0, 4), sharing: false });

/** Deixa microtasks (e cadeias de awaits) terminarem. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 60; i++) await Promise.resolve();
};

interface Node {
  id: string;
  mgr: PeerManager;
  pcs: FakePeerConnection[];
  sent: { to: string; data: SignalData }[];
  streams: { peerId: string; streamId: string | null }[];
  statuses: { peerId: string; status: PeerStatus }[];
  lastPc(): FakePeerConnection;
}

const network = new Map<string, Node>();

function makeNode(id: string, options: { deliver?: boolean } = {}): Node {
  const node: Node = {
    id,
    pcs: [],
    sent: [],
    streams: [],
    statuses: [],
    mgr: undefined as never,
    lastPc() {
      const pc = this.pcs.at(-1);
      if (!pc) throw new Error('nenhuma conexão criada');
      return pc;
    },
  };
  node.mgr = new PeerManager({
    getIceServers: () => [{ urls: 'stun:stun.example.com' }],
    statsIntervalMs: 0,
    createPeerConnection: (config) => {
      const pc = new FakePeerConnection(config);
      node.pcs.push(pc);
      return pc as unknown as RTCPeerConnection;
    },
    sendSignal: (to, data) => {
      node.sent.push({ to, data });
      if (options.deliver !== false) {
        queueMicrotask(() => network.get(to)?.mgr.handleSignal(id, data));
      }
      return true;
    },
  });
  node.mgr.on('remote-stream', ({ peerId, stream }) =>
    node.streams.push({ peerId, streamId: (stream as unknown as FakeStream | null)?.id ?? null }),
  );
  node.mgr.on('status', (e) => node.statuses.push(e));
  network.set(id, node);
  return node;
}

/** A e B se conhecem ao mesmo tempo (o caso normal, que gera glare nas duas offers iniciais). */
async function connectPair(a: Node, b: Node): Promise<void> {
  a.mgr.setSelf(a.id, [peer(b.id)]);
  b.mgr.setSelf(b.id, [peer(a.id)]);
  await settle();
}

const fakeStream = (id: string, withAudio = true) =>
  new FakeStream(id, [
    { id: `${id}-v`, kind: 'video' },
    ...(withAudio ? [{ id: `${id}-a`, kind: 'audio' as const }] : []),
  ]) as unknown as MediaStream;

beforeEach(() => {
  network.clear();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('criação das conexões', () => {
  it('cria uma conexão por peer com os iceServers, data channel pré-negociado e transceiver recvonly', () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B), peer(ID_C)]);

    expect(a.pcs).toHaveLength(2);
    expect(a.mgr.peerIds.sort()).toEqual([ID_B, ID_C]);
    for (const pc of a.pcs) {
      expect(pc.config).toEqual({ iceServers: [{ urls: 'stun:stun.example.com' }] });
      expect(pc.dataChannels).toEqual([{ label: 'ctrl', init: { negotiated: true, id: 0 } }]);
      expect(pc.transceivers.map((t) => t.kind)).toEqual(['video']);
    }
  });

  it('setSelf descarta as conexões antigas (selfId novo após reconexão do WS)', () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B)]);
    const first = a.lastPc();
    a.mgr.setSelf(ID_C, [peer(ID_B)]);
    expect(first.closed).toBe(true);
    expect(a.pcs).toHaveLength(2);
  });

  it('addPeer exige setSelf antes', () => {
    const a = makeNode(ID_A, { deliver: false });
    expect(() => a.mgr.addPeer(peer(ID_B))).toThrow(/setSelf/);
  });

  it('emite status connecting ao criar a conexão', () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B)]);
    // o status inicial é implícito (connecting); só mudanças são emitidas
    expect(a.statuses).toEqual([]);
  });
});

describe('Perfect Negotiation entre dois PeerManagers', () => {
  it('resolve o glare das offers simultâneas e as duas pontas terminam estáveis', async () => {
    const a = makeNode(ID_A);
    const b = makeNode(ID_B);
    await connectPair(a, b);

    for (const node of [a, b]) {
      expect(node.lastPc().signalingState).toBe('stable');
      expect(node.lastPc().remoteDescription).not.toBeNull();
      expect(node.lastPc().localDescription).not.toBeNull();
    }
    // nenhum erro inesperado (candidates de offers ignoradas são descartados em silêncio)
    expect(console.error).not.toHaveBeenCalled();
  });

  it('todo signal enviado leva gen e candidates saem no formato do protocolo', async () => {
    const a = makeNode(ID_A);
    const b = makeNode(ID_B);
    await connectPair(a, b);

    const all = [...a.sent, ...b.sent];
    expect(all.length).toBeGreaterThan(0);
    for (const { data } of all) expect(data.gen).toBe(0);
    const candidate = all.find((m) => m.data.candidate)?.data.candidate;
    expect(candidate).toEqual({
      candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
      usernameFragment: 'ufrag',
    });
  });

  it('não envia candidate nulo (fim da coleta)', () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B)]);
    a.lastPc().onicecandidate?.({ candidate: null });
    expect(a.sent).toEqual([]);
  });

  it('polite e impolite são decididos pela comparação dos ids', async () => {
    const a = makeNode(ID_A, { deliver: false });
    const b = makeNode(ID_B, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B)]);
    b.mgr.setSelf(ID_B, [peer(ID_A)]);
    await settle();
    const offerA = a.sent.find((m) => m.data.description)?.data;
    const offerB = b.sent.find((m) => m.data.description)?.data;
    expect(offerA?.description?.type).toBe('offer');
    expect(offerB?.description?.type).toBe('offer');

    // B (impolite) ignora a offer de A durante a colisão; A (polite) aceita a de B.
    await b.mgr.handleSignal(ID_A, offerA as SignalData);
    await settle();
    expect(b.lastPc().remoteDescription).toBeNull();
    await a.mgr.handleSignal(ID_B, offerB as SignalData);
    await settle();
    expect(a.lastPc().remoteDescription?.type).toBe('offer');
  });
});

describe('compartilhamento de tela', () => {
  it('quem compartilha envia vídeo+áudio e o outro lado recebe o stream', async () => {
    const a = makeNode(ID_A);
    const b = makeNode(ID_B);
    await connectPair(a, b);

    a.mgr.setLocalStream(fakeStream('tela'));
    await settle();

    expect(b.streams).toEqual([{ peerId: ID_A, streamId: 'tela' }]);
    expect(a.streams).toEqual([]); // A não recebe nada de B
    // o vídeo reaproveitou o transceiver recvonly; o áudio ganhou um novo
    expect(a.lastPc().transceivers.map((t) => t.kind)).toEqual(['video', 'audio']);
  });

  it('parar de compartilhar remove as tracks e o outro lado recebe stream nulo', async () => {
    const a = makeNode(ID_A);
    const b = makeNode(ID_B);
    await connectPair(a, b);

    a.mgr.setLocalStream(fakeStream('tela'));
    await settle();
    a.mgr.setLocalStream(null);
    await settle();

    expect(b.streams).toEqual([
      { peerId: ID_A, streamId: 'tela' },
      { peerId: ID_A, streamId: null },
    ]);
    expect(
      a
        .lastPc()
        .getSenders()
        .every((s) => s.track === null),
    ).toBe(true);
  });

  it('compartilhar de novo depois de parar entrega o novo stream', async () => {
    const a = makeNode(ID_A);
    const b = makeNode(ID_B);
    await connectPair(a, b);

    a.mgr.setLocalStream(fakeStream('um'));
    await settle();
    a.mgr.setLocalStream(null);
    await settle();
    a.mgr.setLocalStream(fakeStream('dois'));
    await settle();

    expect(b.streams.map((s) => s.streamId)).toEqual(['um', null, 'dois']);
  });

  it('os dois compartilhando ao mesmo tempo funciona na mesma conexão', async () => {
    const a = makeNode(ID_A);
    const b = makeNode(ID_B);
    await connectPair(a, b);

    a.mgr.setLocalStream(fakeStream('de-a'));
    b.mgr.setLocalStream(fakeStream('de-b'));
    await settle();

    expect(b.streams.at(-1)).toEqual({ peerId: ID_A, streamId: 'de-a' });
    expect(a.streams.at(-1)).toEqual({ peerId: ID_B, streamId: 'de-b' });
    expect(a.lastPc().signalingState).toBe('stable');
    expect(b.lastPc().signalingState).toBe('stable');
  });

  it('quem entra depois já recebe a tela de quem está compartilhando', async () => {
    const a = makeNode(ID_A);
    const b = makeNode(ID_B);
    a.mgr.setSelf(ID_A, []);
    a.mgr.setLocalStream(fakeStream('tela'));

    // B entra: A recebe peer-joined, B recebe joined com A na lista
    a.mgr.addPeer(peer(ID_B));
    b.mgr.setSelf(ID_B, [peer(ID_A)]);
    await settle();

    expect(b.streams).toEqual([{ peerId: ID_A, streamId: 'tela' }]);
  });

  it('em uma sala com três, o stream chega a todos', async () => {
    const a = makeNode(ID_A);
    const b = makeNode(ID_B);
    const c = makeNode(ID_C);
    a.mgr.setSelf(ID_A, [peer(ID_B), peer(ID_C)]);
    b.mgr.setSelf(ID_B, [peer(ID_A), peer(ID_C)]);
    c.mgr.setSelf(ID_C, [peer(ID_A), peer(ID_B)]);
    await settle();

    a.mgr.setLocalStream(fakeStream('tela'));
    await settle();
    expect(b.streams).toEqual([{ peerId: ID_A, streamId: 'tela' }]);
    expect(c.streams).toEqual([{ peerId: ID_A, streamId: 'tela' }]);
  });
});

describe('bitrate', () => {
  const videoSender = (node: Node) =>
    node
      .lastPc()
      .getSenders()
      .find((s) => s.track?.kind === 'video');

  it('aplica o limite padrão ao vídeo depois da negociação e não mexe no áudio', async () => {
    const a = makeNode(ID_A);
    const b = makeNode(ID_B);
    await connectPair(a, b);
    a.mgr.setLocalStream(fakeStream('tela'));
    await settle();

    expect(videoSender(a)?.params.encodings[0]?.maxBitrate).toBe(2_500_000);
    const audio = a
      .lastPc()
      .getSenders()
      .find((s) => s.track?.kind === 'audio');
    expect(audio?.setParametersCalls).toEqual([]);
  });

  it('reaplica ao trocar a qualidade durante o compartilhamento', async () => {
    const a = makeNode(ID_A);
    const b = makeNode(ID_B);
    await connectPair(a, b);
    a.mgr.setLocalStream(fakeStream('tela'));
    await settle();

    a.mgr.setMaxBitrate(1_000_000);
    await settle();
    expect(videoSender(a)?.params.encodings[0]?.maxBitrate).toBe(1_000_000);
    a.mgr.setMaxBitrate(5_000_000);
    await settle();
    expect(videoSender(a)?.params.encodings[0]?.maxBitrate).toBe(5_000_000);
  });

  it('antes da negociação (encodings vazio) não chama setParameters', () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B)]);
    a.mgr.setLocalStream(fakeStream('tela'));
    a.mgr.setMaxBitrate(1_000_000);
    expect(videoSender(a)?.setParametersCalls).toEqual([]);
  });
});

describe('geração (gen) e reset', () => {
  const offer = (gen: number): SignalData => ({
    gen,
    description: { type: 'offer', sdp: '{"tracks":[]}' },
  });

  it('descarta mensagens de geração antiga', async () => {
    vi.useFakeTimers();
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B)]);
    a.lastPc().setConnectionState('failed');
    await vi.advanceTimersByTimeAsync(10_000); // recria: gen 1
    expect(a.pcs).toHaveLength(2);

    a.mgr.handleSignal(ID_B, offer(0));
    await settle();
    expect(a.lastPc().remoteDescription).toBeNull();
  });

  it('mensagem de geração maior recria a conexão sem enviar reset de volta', async () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B)]);
    await settle();
    a.sent.length = 0;
    const old = a.lastPc();

    a.mgr.handleSignal(ID_B, { gen: 5, reset: true });
    await settle();
    expect(old.closed).toBe(true);
    expect(a.pcs).toHaveLength(2);
    expect(a.sent.some((m) => m.data.reset)).toBe(false);
    expect(a.sent.every((m) => m.data.gen === 5)).toBe(true); // a nova offer já usa gen 5

    // e a offer seguinte com gen 5 é aplicada na nova conexão
    a.mgr.handleSignal(ID_B, offer(5));
    await settle();
    expect(a.lastPc().remoteDescription?.type).toBe('offer');
  });

  it('mensagem de geração maior sem reset também acompanha a nova geração', async () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B)]);
    a.mgr.handleSignal(ID_B, offer(3));
    await settle();
    expect(a.pcs).toHaveLength(2);
    expect(a.lastPc().remoteDescription?.type).toBe('offer');
  });

  it('reset com a mesma geração é ignorado (os dois lados já recriaram)', async () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B)]);
    a.mgr.handleSignal(ID_B, { gen: 0, reset: true });
    await settle();
    expect(a.pcs).toHaveLength(1);
  });

  it('signal de peer desconhecido é ignorado', () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, []);
    expect(() => a.mgr.handleSignal(ID_C, offer(0))).not.toThrow();
    expect(console.warn).toHaveBeenCalled();
  });

  it('recriar emite stream nulo para quem estava transmitindo', async () => {
    vi.useFakeTimers();
    const a = makeNode(ID_A);
    const b = makeNode(ID_B);
    await connectPair(a, b);
    a.mgr.setLocalStream(fakeStream('tela'));
    await settle();
    b.streams.length = 0;

    b.lastPc().setConnectionState('failed');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(b.streams[0]).toEqual({ peerId: ID_A, streamId: null });
  });
});

describe('falhas de conexão', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('failed → restartIce uma vez e status failed', async () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B)]);
    const pc = a.lastPc();
    pc.setConnectionState('failed');
    pc.setConnectionState('failed');
    expect(pc.restartIceCalls).toBe(1);
    expect(a.statuses).toEqual([{ peerId: ID_B, status: 'failed' }]);
  });

  it('failed que persiste por 10 s recria a conexão e avisa o peer com reset', async () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B)]);
    const first = a.lastPc();
    first.setConnectionState('failed');
    await vi.advanceTimersByTimeAsync(9_999);
    expect(a.pcs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(first.closed).toBe(true);
    expect(a.pcs).toHaveLength(2);
    expect(a.sent).toContainEqual({ to: ID_B, data: { gen: 1, reset: true } });
    // a conexão nova ganha seu próprio restartIce se falhar de novo
    a.lastPc().setConnectionState('failed');
    expect(a.lastPc().restartIceCalls).toBe(1);
  });

  it('failed que se recupera antes de 10 s não recria', async () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B)]);
    a.lastPc().setConnectionState('failed');
    await vi.advanceTimersByTimeAsync(5_000);
    a.lastPc().setConnectionState('connected');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(a.pcs).toHaveLength(1);
  });

  it('disconnected que persiste por 10 s recria; se volta a connected, não', async () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B)]);

    a.lastPc().setConnectionState('disconnected');
    await vi.advanceTimersByTimeAsync(5_000);
    a.lastPc().setConnectionState('connected');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(a.pcs).toHaveLength(1);

    a.lastPc().setConnectionState('disconnected');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(a.pcs).toHaveLength(2);
    expect(a.lastPc().restartIceCalls).toBe(0); // disconnected não força restartIce
  });

  it('o timeout é configurável', async () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr = new PeerManager({
      getIceServers: () => [],
      brokenTimeoutMs: 1_000,
      statsIntervalMs: 0,
      sendSignal: () => true,
      createPeerConnection: (config) => {
        const pc = new FakePeerConnection(config);
        a.pcs.push(pc);
        return pc as unknown as RTCPeerConnection;
      },
    });
    a.mgr.setSelf(ID_A, [peer(ID_B)]);
    a.lastPc().setConnectionState('disconnected');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(a.pcs).toHaveLength(2);
  });
});

describe('tipo de conexão (P2P vs relay)', () => {
  const connectedStatus = async (
    local: 'host' | 'srflx' | 'relay',
    remote: 'host' | 'srflx' | 'relay',
  ) => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B)]);
    a.lastPc().setSelectedPair(local, remote);
    a.lastPc().setConnectionState('connected');
    await settle();
    return a.statuses.at(-1)?.status;
  };

  it('par direto → p2p', async () => {
    expect(await connectedStatus('host', 'srflx')).toBe('p2p');
  });

  it('candidate local ou remoto relay → relay', async () => {
    expect(await connectedStatus('relay', 'host')).toBe('relay');
    expect(await connectedStatus('host', 'relay')).toBe('relay');
  });

  it('sem par selecionado ainda continua connecting (sem emitir mudança)', async () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B)]);
    a.lastPc().setConnectionState('connected');
    await settle();
    expect(a.statuses).toEqual([]);
  });

  it('volta de failed para connecting e depois classifica de novo', async () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B)]);
    const pc = a.lastPc();
    pc.setConnectionState('failed');
    pc.setSelectedPair('host', 'host');
    pc.setConnectionState('connected');
    await settle();
    expect(a.statuses.map((s) => s.status)).toEqual(['failed', 'connecting', 'p2p']);
  });
});

describe('saída de peers e encerramento', () => {
  it('removePeer fecha a conexão e emite stream nulo se ele estava transmitindo', async () => {
    const a = makeNode(ID_A);
    const b = makeNode(ID_B);
    await connectPair(a, b);
    a.mgr.setLocalStream(fakeStream('tela'));
    await settle();

    const pc = b.lastPc();
    b.mgr.removePeer(ID_A);
    expect(pc.closed).toBe(true);
    expect(b.mgr.peerIds).toEqual([]);
    expect(b.streams.at(-1)).toEqual({ peerId: ID_A, streamId: null });
  });

  it('removePeer de um peer desconhecido não faz nada', () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, []);
    expect(() => a.mgr.removePeer(ID_B)).not.toThrow();
  });

  it('closeAll fecha tudo e silencia eventos tardios', async () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B), peer(ID_C)]);
    const pcs = [...a.pcs];
    a.mgr.closeAll();
    expect(pcs.every((pc) => pc.closed)).toBe(true);
    expect(a.mgr.peerIds).toEqual([]);

    // eventos de conexões já fechadas são ignorados
    pcs[0]?.onicecandidate?.({ candidate: null });
    pcs[0]?.setConnectionState('failed');
    expect(a.statuses).toEqual([]);
  });

  it('para de enviar para um peer que saiu mesmo com stream local ativo', async () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B)]);
    a.mgr.setLocalStream(fakeStream('tela'));
    a.mgr.removePeer(ID_B);
    a.mgr.setLocalStream(null); // não deve tocar na conexão fechada
    expect(
      a
        .lastPc()
        .getSenders()
        .some((s) => s.track !== null),
    ).toBe(true);
  });
});
