import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Session } from './auth';
import {
  buildWsUrl,
  SignalingClient,
  type CloseReason,
  type SignalingClientOptions,
  type WebSocketLike,
} from './signaling-client';

const ID_A = '3f2b8c1e-5a47-4d6b-9c1a-0e7d2f4b6a10';
const ID_B = '9a1d7e52-83c4-4f0b-b6a2-1c5e8d3f7a21';
const ID_C = 'c0ffee00-83c4-4f0b-b6a2-1c5e8d3f7a21';

class FakeSocket implements WebSocketLike {
  static instances: FakeSocket[] = [];
  readyState = 0;
  sent: Record<string, unknown>[] = [];
  closeCalls: number[] = [];
  onopen: ((event: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(code = 1000): void {
    this.closeCalls.push(code);
    this.readyState = 3;
  }

  // --- ações do "servidor" nos testes ---
  open(): void {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(message: unknown): void {
    this.onmessage?.({ data: typeof message === 'string' ? message : JSON.stringify(message) });
  }
  drop(code = 1006): void {
    this.readyState = 3;
    this.onclose?.({ code });
  }
  sentTypes(): unknown[] {
    return this.sent.map((m) => m.type);
  }
}

const last = (): FakeSocket => {
  const socket = FakeSocket.instances.at(-1);
  if (!socket) throw new Error('nenhum socket criado');
  return socket;
};

const joined = (selfId = ID_A, peers: unknown[] = []) => ({ type: 'joined', selfId, peers });

describe('SignalingClient', () => {
  let now: number;
  let session: Session | null;
  let sharing: boolean;

  const make = (extra: Partial<SignalingClientOptions> = {}) =>
    new SignalingClient({
      url: 'wss://share.example.com/ws',
      room: 'sala',
      name: 'Ana',
      getSession: () => session,
      getSharing: () => sharing,
      webSocketFactory: (url) => new FakeSocket(url),
      now: () => now,
      ...extra,
    });

  /** Conecta e confirma o join; devolve o cliente e o socket. */
  const connected = (extra: Partial<SignalingClientOptions> = {}) => {
    const client = make(extra);
    client.connect();
    last().open();
    last().receive(joined());
    return { client, socket: last() };
  };

  const closedReasons = (client: SignalingClient): CloseReason[] => {
    const reasons: CloseReason[] = [];
    client.on('closed', ({ reason }) => reasons.push(reason));
    return reasons;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    now = 1_000_000;
    session = { token: 'tok en/1', expiresAt: now + 3_600_000 };
    sharing = false;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('conecta com o token na query, envia join e fica connected ao receber joined', () => {
    const client = make();
    const statuses: string[] = [];
    client.on('status', (s) => statuses.push(s));
    const joinedEvents: unknown[] = [];
    client.on('joined', (e) => joinedEvents.push(e));

    client.connect();
    expect(last().url).toBe('wss://share.example.com/ws?token=tok%20en%2F1');
    expect(client.status).toBe('connecting');

    last().open();
    expect(last().sent).toEqual([{ type: 'join', room: 'sala', name: 'Ana' }]);

    last().receive(joined(ID_A, [{ id: ID_B, name: 'Bia', sharing: true }]));
    expect(client.status).toBe('connected');
    expect(statuses).toEqual(['connecting', 'connected']);
    expect(joinedEvents).toEqual([
      { selfId: ID_A, peers: [{ id: ID_B, name: 'Bia', sharing: true }] },
    ]);
  });

  it('encaminha peer-joined, peer-left, signal e peer-sharing', () => {
    const { client, socket } = connected();
    const events: unknown[] = [];
    client.on('peer-joined', (e) => events.push(['peer-joined', e]));
    client.on('peer-left', (e) => events.push(['peer-left', e]));
    client.on('signal', (e) => events.push(['signal', e]));
    client.on('peer-sharing', (e) => events.push(['peer-sharing', e]));

    const peer = { id: ID_B, name: 'Bia', sharing: false };
    const data = { gen: 0, reset: true as const };
    socket.receive({ type: 'peer-joined', peer });
    socket.receive({ type: 'signal', from: ID_B, data });
    socket.receive({ type: 'peer-sharing', id: ID_B, active: true });
    socket.receive({ type: 'peer-left', id: ID_B });

    expect(events).toEqual([
      ['peer-joined', peer],
      ['signal', { from: ID_B, data }],
      ['peer-sharing', { id: ID_B, active: true }],
      ['peer-left', ID_B],
    ]);
  });

  it('on() devolve função que remove o listener', () => {
    const { client, socket } = connected();
    const handler = vi.fn();
    const off = client.on('peer-left', handler);
    socket.receive({ type: 'peer-left', id: ID_B });
    off();
    socket.receive({ type: 'peer-left', id: ID_C });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('sendSignal e sendSharing só enviam quando connected', () => {
    const client = make();
    expect(client.sendSignal(ID_B, { gen: 0, reset: true })).toBe(false);
    client.connect();
    last().open();
    // socket aberto, mas join ainda não confirmado
    expect(client.sendSharing(true)).toBe(false);

    last().receive(joined());
    expect(client.sendSignal(ID_B, { gen: 1, reset: true })).toBe(true);
    expect(client.sendSharing(true)).toBe(true);
    expect(last().sent.slice(1)).toEqual([
      { type: 'signal', to: ID_B, data: { gen: 1, reset: true } },
      { type: 'sharing', active: true },
    ]);
  });

  it('manda ping a cada 25 s e mantém a conexão se o pong chega', () => {
    const { client, socket } = connected();
    vi.advanceTimersByTime(25_000);
    expect(socket.sentTypes()).toEqual(['join', 'ping']);
    socket.receive({ type: 'pong' });
    vi.advanceTimersByTime(25_000);
    expect(socket.sentTypes()).toEqual(['join', 'ping', 'ping']);
    socket.receive({ type: 'pong' });
    vi.advanceTimersByTime(24_000); // ainda antes do próximo ping
    expect(client.status).toBe('connected');
  });

  it('sem pong em 10 s trata como queda e reconecta', () => {
    const { client, socket } = connected();
    const disconnected = vi.fn();
    client.on('disconnected', disconnected);

    vi.advanceTimersByTime(25_000); // ping
    vi.advanceTimersByTime(10_000); // pong não veio
    expect(client.status).toBe('reconnecting');
    expect(disconnected).toHaveBeenCalledTimes(1);
    expect(socket.closeCalls).toEqual([1000]);

    vi.advanceTimersByTime(1_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('reconecta com backoff exponencial 1s → 15s e zera após joined', () => {
    const client = make();
    client.connect();
    const delays: number[] = [];

    for (let i = 0; i < 6; i++) {
      const before = FakeSocket.instances.length;
      last().drop();
      // descobre o atraso avançando 1 ms por vez seria lento; checa por limites
      const expected = Math.min(15_000, 1_000 * 2 ** i);
      vi.advanceTimersByTime(expected - 1);
      expect(FakeSocket.instances).toHaveLength(before);
      vi.advanceTimersByTime(1);
      expect(FakeSocket.instances).toHaveLength(before + 1);
      delays.push(expected);
    }
    expect(delays).toEqual([1000, 2000, 4000, 8000, 15000, 15000]);

    // join confirmado zera o contador
    last().open();
    last().receive(joined());
    last().drop();
    vi.advanceTimersByTime(999);
    const count = FakeSocket.instances.length;
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(count + 1);
  });

  it('emite disconnected só uma vez por queda, mesmo com tentativas falhando', () => {
    const { client, socket } = connected();
    const disconnected = vi.fn();
    client.on('disconnected', disconnected);
    socket.drop();
    vi.advanceTimersByTime(1_000);
    last().drop(); // tentativa de reconexão falhou sem chegar a abrir
    vi.advanceTimersByTime(2_000);
    expect(disconnected).toHaveBeenCalledTimes(1);
  });

  it('reenvia join com sharing:true ao reconectar enquanto compartilha', () => {
    const { socket } = connected();
    sharing = true;
    socket.drop();
    vi.advanceTimersByTime(1_000);
    last().open();
    expect(last().sent).toEqual([{ type: 'join', room: 'sala', name: 'Ana', sharing: true }]);
  });

  it('ao reconectar emite novo joined com o novo selfId', () => {
    const { client, socket } = connected();
    const ids: string[] = [];
    client.on('joined', (e) => ids.push(e.selfId));
    socket.drop();
    vi.advanceTimersByTime(1_000);
    last().open();
    last().receive(joined(ID_C));
    expect(ids).toEqual([ID_C]);
    expect(client.status).toBe('connected');
  });

  it('ignora eventos de sockets antigos', () => {
    const { client, socket: first } = connected();
    first.drop();
    vi.advanceTimersByTime(1_000);
    const second = last();
    second.open();
    second.receive(joined(ID_C));

    const handler = vi.fn();
    client.on('peer-left', handler);
    first.receive({ type: 'peer-left', id: ID_B });
    first.drop();
    expect(handler).not.toHaveBeenCalled();
    expect(client.status).toBe('connected');
  });

  it('encerra com auth-expired sem criar socket se não há sessão ou ela vai expirar', () => {
    session = null;
    const client = make();
    const reasons = closedReasons(client);
    client.connect();
    expect(FakeSocket.instances).toHaveLength(0);
    expect(reasons).toEqual(['auth-expired']);
    expect(client.status).toBe('closed');

    session = { token: 't', expiresAt: now + 4 * 60_000 }; // menos de 5 min
    const second = make();
    const reasons2 = closedReasons(second);
    second.connect();
    expect(reasons2).toEqual(['auth-expired']);
  });

  it('para de reconectar com auth-expired quando o token expira durante a queda', () => {
    const { client, socket } = connected();
    const reasons = closedReasons(client);
    socket.drop();
    session = null;
    vi.advanceTimersByTime(1_000);
    expect(reasons).toEqual(['auth-expired']);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('ROOM_FULL / NAME_TAKEN / RATE_LIMITED emitem error e encerram sem reconectar', () => {
    for (const code of ['ROOM_FULL', 'NAME_TAKEN', 'RATE_LIMITED'] as const) {
      FakeSocket.instances = [];
      const client = make();
      const reasons = closedReasons(client);
      const errors: string[] = [];
      client.on('error', (e) => errors.push(e.code));
      client.connect();
      last().open();
      last().receive({ type: 'error', code, message: 'x' });
      expect(errors).toEqual([code]);
      expect(reasons).toEqual(['rejected']);
      vi.advanceTimersByTime(60_000);
      expect(FakeSocket.instances).toHaveLength(1);
    }
  });

  it('INVALID e ALREADY_JOINED só emitem error e mantêm a conexão', () => {
    const { client, socket } = connected();
    const errors: string[] = [];
    client.on('error', (e) => errors.push(e.code));
    socket.receive({ type: 'error', code: 'INVALID', message: 'x' });
    socket.receive({ type: 'error', code: 'ALREADY_JOINED', message: 'x' });
    expect(errors).toEqual(['INVALID', 'ALREADY_JOINED']);
    expect(client.status).toBe('connected');
  });

  it('close 1008 (policy) e 4001 (replaced) são definitivos', () => {
    for (const [code, reason] of [
      [1008, 'policy'],
      [4001, 'replaced'],
    ] as const) {
      FakeSocket.instances = [];
      const { client, socket } = connected();
      const reasons = closedReasons(client);
      socket.drop(code);
      expect(reasons).toEqual([reason]);
      vi.advanceTimersByTime(60_000);
      expect(FakeSocket.instances).toHaveLength(1);
    }
  });

  it('disconnect() envia leave, fecha o socket e não reconecta', () => {
    const { client, socket } = connected();
    const reasons = closedReasons(client);
    client.disconnect();
    expect(socket.sentTypes()).toEqual(['join', 'leave']);
    expect(socket.closeCalls).toEqual([1000]);
    expect(client.status).toBe('closed');
    expect(reasons).toEqual(['disconnect']);
    vi.advanceTimersByTime(120_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(socket.sentTypes()).toEqual(['join', 'leave']); // sem ping depois
  });

  it('disconnect() durante a espera de reconexão cancela a tentativa', () => {
    const { client, socket } = connected();
    socket.drop();
    client.disconnect();
    vi.advanceTimersByTime(60_000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(client.status).toBe('closed');
  });

  it('permite connect() de novo depois de closed', () => {
    const { client } = connected();
    client.disconnect();
    client.connect();
    expect(FakeSocket.instances).toHaveLength(2);
    expect(client.status).toBe('connecting');
  });

  it('connect() repetido é ignorado enquanto ativo', () => {
    const client = make();
    client.connect();
    client.connect();
    expect(FakeSocket.instances).toHaveLength(1);
  });

  it('ignora mensagens inválidas do servidor sem derrubar a conexão', () => {
    const { client, socket } = connected();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    socket.receive('{nope');
    socket.receive({ type: 'desconhecido' });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(client.status).toBe('connected');
  });
});

describe('buildWsUrl', () => {
  it('usa wss em https e ws em http', () => {
    expect(buildWsUrl({ protocol: 'https:', host: 'share.example.com' })).toBe(
      'wss://share.example.com/ws',
    );
    expect(buildWsUrl({ protocol: 'http:', host: 'localhost:5173' })).toBe(
      'ws://localhost:5173/ws',
    );
  });
});
