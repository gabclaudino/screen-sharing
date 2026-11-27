import {
  connectionReportSchema,
  type ConnectionReport,
  type SignalData,
} from '@screenshare/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakePeerConnection, FakeStream } from './fake-webrtc';
import { PeerManager, type ConnectionInfo, type PeerStatus } from './peer-manager';

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
  connections: { peerId: string; info: ConnectionInfo }[];
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
    connections: [],
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
  node.mgr.on('connection', (e) => node.connections.push(e));
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

  const screenStream = (id: string, width: number, height: number) =>
    new FakeStream(id, [
      { id: `${id}-v`, kind: 'video', getSettings: () => ({ width, height }) },
    ]) as unknown as MediaStream;

  it('limita a resolução enviada a 1080p quando a captura é maior (1440p e 4K)', async () => {
    for (const [width, height, scale] of [
      [2560, 1440, 2560 / 1920],
      [3840, 2160, 2],
    ] as const) {
      const a = makeNode(ID_A);
      const b = makeNode(ID_B);
      await connectPair(a, b);
      a.mgr.setLocalStream(screenStream(`t${width}`, width, height));
      await settle();
      expect(videoSender(a)?.params.encodings[0]?.scaleResolutionDownBy).toBeCloseTo(scale, 4);
    }
  });

  it('captura que já cabe em 1080p não ganha escala (nada é ampliado nem reduzido)', async () => {
    const a = makeNode(ID_A);
    const b = makeNode(ID_B);
    await connectPair(a, b);
    a.mgr.setLocalStream(screenStream('hd', 1920, 1080));
    await settle();
    expect(videoSender(a)?.params.encodings[0]?.maxBitrate).toBe(2_500_000);
    expect(videoSender(a)?.params.encodings[0]?.scaleResolutionDownBy).toBeUndefined();
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

  it('informa os detalhes do caminho: tipos de candidate, protocolo do relay e IPv6', async () => {
    const connection = async (
      local: 'host' | 'srflx' | 'relay',
      remote: 'host' | 'srflx' | 'relay',
      extra: { relayProtocol?: string; address?: string } = {},
    ) => {
      const a = makeNode(ID_A, { deliver: false });
      a.mgr.setSelf(ID_A, [peer(ID_B)]);
      a.lastPc().setSelectedPair(local, remote, extra);
      a.lastPc().setConnectionState('connected');
      await settle();
      return a.connections.at(-1)?.info;
    };

    expect(await connection('host', 'host', { address: '2001:db8::1' })).toEqual({
      type: 'p2p',
      local: 'host',
      remote: 'host',
      relayProtocol: null,
      ipv6: true,
    });
    expect(await connection('srflx', 'srflx', { address: '200.1.2.3' })).toMatchObject({
      type: 'p2p',
      ipv6: false,
    });
    expect(await connection('relay', 'host', { relayProtocol: 'udp' })).toMatchObject({
      type: 'relay',
      relayProtocol: 'udp',
    });
    expect(await connection('relay', 'srflx', { relayProtocol: 'tcp' })).toMatchObject({
      relayProtocol: 'tcp',
    });
    // Relay do lado do outro: não dá para saber o protocolo dele.
    expect(await connection('host', 'relay')).toMatchObject({ type: 'relay', relayProtocol: null });
  });

  it('só avisa os detalhes quando mudam (o getStats periódico não repete)', async () => {
    vi.useFakeTimers();
    const node = makeNode(ID_A, { deliver: false });
    node.mgr.setSelf(ID_A, [peer(ID_B)]);
    const pc = node.lastPc();
    pc.setSelectedPair('host', 'host');
    pc.setConnectionState('connected');
    await vi.advanceTimersByTimeAsync(0);
    pc.setConnectionState('connected');
    await vi.advanceTimersByTimeAsync(0);
    expect(node.connections).toHaveLength(1);
    pc.setSelectedPair('relay', 'host', { relayProtocol: 'tcp' });
    pc.setConnectionState('connected');
    await vi.advanceTimersByTimeAsync(0);
    expect(node.connections.map((c) => c.info.relayProtocol)).toEqual([null, 'tcp']);
    vi.useRealTimers();
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

describe('diagnóstico das conexões', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  const watch = (iceServers: RTCIceServer[] = [], connectTimeoutMs = 0) => {
    const pcs: FakePeerConnection[] = [];
    const reports: ConnectionReport[] = [];
    const mgr = new PeerManager({
      getIceServers: () => iceServers,
      statsIntervalMs: 0,
      connectTimeoutMs,
      sendSignal: () => true,
      createPeerConnection: (config) => {
        const pc = new FakePeerConnection(config);
        pcs.push(pc);
        return pc as unknown as RTCPeerConnection;
      },
    });
    mgr.on('report', (report) => reports.push(report));
    mgr.setSelf(ID_A, [peer(ID_B)]);
    const pc = pcs[0] as FakePeerConnection;
    return { mgr, pc, reports };
  };

  it('relata aos 15 s e 60 s enquanto não conecta, com o que foi trocado', async () => {
    const { reports } = watch([{ urls: ['turn:turn.example.com:3478'] }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reports.map((r) => [r.event, r.ms])).toEqual([
      ['slow', 15_000],
      ['slow', 60_000],
    ]);
    expect(reports[0]).toMatchObject({
      self: ID_A,
      peer: ID_B,
      remoteDescription: false,
      sent: { host: 1 },
      received: { host: 0 },
      turn: true,
    });
    expect(connectionReportSchema.safeParse(reports[0]).success).toBe(true);
  });

  it('conectou: relata o caminho uma vez e não acusa lentidão', async () => {
    const { pc, reports } = watch();
    pc.setSelectedPair('host', 'relay');
    pc.setConnectionState('connected');
    await vi.advanceTimersByTimeAsync(60_000);
    pc.setConnectionState('connected');
    await vi.advanceTimersByTimeAsync(0);
    expect(reports.map((r) => r.event)).toEqual(['connected']);
    expect(reports[0]).toMatchObject({ turn: false, path: { type: 'relay' } });
    expect(connectionReportSchema.safeParse(reports[0]).success).toBe(true);
  });

  it('falha é relatada', () => {
    const { pc, reports } = watch();
    pc.setConnectionState('failed');
    expect(reports.map((r) => r.event)).toEqual(['failed']);
  });

  it('o tempo limite é relatado antes de recriar', async () => {
    const { reports } = watch([], 20_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reports.map((r) => [r.event, r.gen])).toEqual([
      ['slow', 0],
      ['timeout', 0],
    ]);
    expect(connectionReportSchema.safeParse(reports[1]).success).toBe(true);
  });

  it('desfeita sem conectar (F5): relata só depois de 3 s', async () => {
    const quick = watch();
    quick.mgr.removePeer(ID_B);
    expect(quick.reports).toEqual([]);

    const stuck = watch();
    await vi.advanceTimersByTimeAsync(5_000);
    stuck.mgr.reportPending();
    stuck.mgr.removePeer(ID_B);
    expect(stuck.reports.map((r) => r.event)).toEqual(['abandoned', 'abandoned']);
  });
});

describe('tentativa de conexão que não avança', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  // ID_A < ID_B: A é o lado polite (30 s); B age primeiro (20 s).
  it('recria depois do prazo, com um reset; o prazo cresce a cada tentativa', async () => {
    const b = makeNode(ID_B, { deliver: false });
    b.mgr.setSelf(ID_B, [peer(ID_A)]);
    await vi.advanceTimersByTimeAsync(19_999);
    expect(b.pcs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.pcs).toHaveLength(2);
    expect(b.pcs[0]?.closed).toBe(true);
    expect(b.sent).toContainEqual({ to: ID_A, data: { gen: 1, reset: true } });

    await vi.advanceTimersByTimeAsync(39_999);
    expect(b.pcs).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.pcs).toHaveLength(3);
    // teto: 3× o prazo inicial
    await vi.advanceTimersByTimeAsync(60_000 * 2);
    expect(b.pcs).toHaveLength(5);
  });

  it('o lado polite espera 10 s a mais', async () => {
    const a = makeNode(ID_A, { deliver: false });
    a.mgr.setSelf(ID_A, [peer(ID_B)]);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(a.pcs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(a.pcs).toHaveLength(2);
  });

  it('conectou dentro do prazo: não recria', async () => {
    const b = makeNode(ID_B, { deliver: false });
    b.mgr.setSelf(ID_B, [peer(ID_A)]);
    b.lastPc().setConnectionState('connected');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(b.pcs).toHaveLength(1);
  });

  it('negociação perdida: os dois lados passam juntos para a nova tentativa', async () => {
    // A não recebe nada na primeira tentativa; depois as mensagens passam.
    const a = makeNode(ID_A, { deliver: false });
    const b = makeNode(ID_B, { deliver: false });
    await connectPair(a, b);
    for (const [from, to] of [
      [a, b],
      [b, a],
    ] as const) {
      const push = from.sent.push.bind(from.sent);
      from.sent.push = (...items) => {
        for (const item of items) queueMicrotask(() => to.mgr.handleSignal(from.id, item.data));
        return push(...items);
      };
    }
    await vi.advanceTimersByTimeAsync(20_000);

    expect([a.pcs.length, b.pcs.length]).toEqual([2, 2]);
    for (const node of [a, b]) {
      expect(node.lastPc().signalingState).toBe('stable');
      expect(node.lastPc().remoteDescription).not.toBeNull();
    }
  });

  it('nova tentativa depois de uma falha que fica parada também é recriada', async () => {
    const b = makeNode(ID_B, { deliver: false });
    b.mgr.setSelf(ID_B, [peer(ID_A)]);
    const pc = b.lastPc();
    pc.setConnectionState('connected');
    pc.setConnectionState('failed');
    pc.setConnectionState('connecting');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(b.pcs).toHaveLength(2);
  });
});
