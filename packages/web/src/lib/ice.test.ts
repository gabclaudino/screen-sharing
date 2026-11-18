import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_ICE_SERVERS, fetchIceServers, IceServerStore } from './ice';

const TURN = {
  urls: ['turn:turn.example.com:3478?transport=udp'],
  username: 'u',
  credential: 'c',
};

const respond = (status: number, body?: unknown): typeof fetch =>
  (() =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), { status }),
    )) as typeof fetch;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('fetchIceServers', () => {
  it('envia o token no header Authorization (nunca na URL) e devolve os servidores', async () => {
    let captured: { url: string; init: RequestInit | undefined } | undefined;
    const fetchImpl = ((url: string, init?: RequestInit) => {
      captured = { url, init };
      return Promise.resolve(new Response(JSON.stringify({ iceServers: [TURN] }), { status: 200 }));
    }) as typeof fetch;

    await expect(fetchIceServers('meu-token', fetchImpl)).resolves.toEqual([TURN]);
    expect(captured?.url).toBe('/api/ice');
    expect(captured?.init?.headers).toEqual({ Authorization: 'Bearer meu-token' });
  });

  it('HTTP de erro, formato inválido e lista vazia lançam', async () => {
    await expect(fetchIceServers('t', respond(401, { error: 'x' }))).rejects.toThrow(/401/);
    await expect(fetchIceServers('t', respond(200, { foo: 1 }))).rejects.toThrow(/formato/);
    await expect(fetchIceServers('t', respond(200, { iceServers: [] }))).rejects.toThrow(/formato/);
  });
});

describe('IceServerStore', () => {
  const session = { token: 'tok', expiresAt: Date.now() + 3_600_000 };

  it('começa com o fallback só-STUN, sem avisar', () => {
    const onFallbackChange = vi.fn();
    const store = new IceServerStore({ getSession: () => session, onFallbackChange });
    expect(store.get()).toEqual(FALLBACK_ICE_SERVERS);
    expect(store.usingFallback).toBe(false);
    expect(onFallbackChange).not.toHaveBeenCalled();
  });

  it('refresh com sucesso passa a usar os servidores do backend', async () => {
    const store = new IceServerStore({
      getSession: () => session,
      fetchImpl: respond(200, { iceServers: [TURN] }),
    });
    await store.refresh();
    expect(store.get()).toEqual([TURN]);
    expect(store.usingFallback).toBe(false);
  });

  it.each([
    ['HTTP 500', respond(500)],
    ['HTTP 401', respond(401)],
    ['resposta inválida', respond(200, { nada: true })],
    ['rede fora', (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch],
  ])('falha (%s) cai para STUN, avisa uma vez e nunca lança', async (_label, fetchImpl) => {
    const onFallbackChange = vi.fn();
    const store = new IceServerStore({ getSession: () => session, fetchImpl, onFallbackChange });

    await expect(store.refresh()).resolves.toBeUndefined();
    await store.refresh();
    expect(store.get()).toEqual(FALLBACK_ICE_SERVERS);
    expect(store.usingFallback).toBe(true);
    expect(onFallbackChange).toHaveBeenCalledTimes(1);
    expect(onFallbackChange).toHaveBeenCalledWith(true);
  });

  it('sem sessão cai para STUN sem chamar a rede', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const store = new IceServerStore({ getSession: () => null, fetchImpl });
    await store.refresh();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.usingFallback).toBe(true);
  });

  it('recupera: depois de uma falha, um sucesso volta aos servidores do backend', async () => {
    let ok = false;
    const onFallbackChange = vi.fn();
    const fetchImpl = (() =>
      Promise.resolve(
        ok
          ? new Response(JSON.stringify({ iceServers: [TURN] }), { status: 200 })
          : new Response(null, { status: 500 }),
      )) as typeof fetch;
    const store = new IceServerStore({ getSession: () => session, fetchImpl, onFallbackChange });

    await store.refresh();
    ok = true;
    await store.refresh();
    expect(store.get()).toEqual([TURN]);
    expect(onFallbackChange.mock.calls).toEqual([[true], [false]]);
  });

  it('renova periodicamente e para com stop()', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(respond(200, { iceServers: [TURN] }));
    const store = new IceServerStore({
      getSession: () => session,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      refreshMs: 1_000,
    });

    store.startAutoRefresh();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    store.stop();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});
