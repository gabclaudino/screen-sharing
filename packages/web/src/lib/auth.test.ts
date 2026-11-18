import { describe, expect, it } from 'vitest';
import { clearStoredSession, loadStoredSession, login, LoginError, storeSession } from './auth';

const fakeStorage = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
};

const respond = (status: number, body?: unknown): typeof fetch =>
  (() =>
    Promise.resolve(
      new Response(body === undefined ? null : JSON.stringify(body), { status }),
    )) as typeof fetch;

describe('login', () => {
  it('devolve a sessão em caso de sucesso e envia a senha por POST JSON', async () => {
    let captured: { url: string; init: RequestInit | undefined } | undefined;
    const fetchImpl = ((url: string, init?: RequestInit) => {
      captured = { url, init };
      return Promise.resolve(
        new Response(JSON.stringify({ token: 'abc', expiresAt: 123 }), { status: 200 }),
      );
    }) as typeof fetch;

    await expect(login('segredo', fetchImpl)).resolves.toEqual({ token: 'abc', expiresAt: 123 });
    expect(captured?.url).toBe('/api/login');
    expect(captured?.init?.method).toBe('POST');
    expect(JSON.parse(String(captured?.init?.body))).toEqual({ password: 'segredo' });
  });

  it.each([
    [401, 'BAD_PASSWORD'],
    [429, 'RATE_LIMITED'],
    [500, 'SERVER'],
  ])('status %i vira LoginError %s', async (status, code) => {
    await expect(login('x', respond(status, { error: 'x' }))).rejects.toMatchObject({
      name: 'LoginError',
      code,
    });
  });

  it('falha de rede vira NETWORK', async () => {
    const failing = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
    const error = await login('x', failing).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LoginError);
    expect(error).toMatchObject({ code: 'NETWORK' });
  });

  it('resposta 200 malformada vira SERVER', async () => {
    await expect(login('x', respond(200, { foo: 1 }))).rejects.toMatchObject({ code: 'SERVER' });
  });
});

describe('sessão guardada', () => {
  it('guarda e recupera uma sessão válida', () => {
    const storage = fakeStorage();
    storeSession({ token: 't', expiresAt: 5000 }, storage);
    expect(loadStoredSession(1000, storage)).toEqual({ token: 't', expiresAt: 5000 });
  });

  it('descarta sessão expirada e limpa o storage', () => {
    const storage = fakeStorage();
    storeSession({ token: 't', expiresAt: 5000 }, storage);
    expect(loadStoredSession(5000, storage)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it('descarta conteúdo corrompido', () => {
    const storage = fakeStorage();
    storage.setItem('screenshare.session', '{nope');
    expect(loadStoredSession(0, storage)).toBeNull();
    storage.setItem('screenshare.session', JSON.stringify({ token: 1 }));
    expect(loadStoredSession(0, storage)).toBeNull();
    expect(storage.data.size).toBe(0);
  });

  it('clearStoredSession remove a sessão', () => {
    const storage = fakeStorage();
    storeSession({ token: 't', expiresAt: 5000 }, storage);
    clearStoredSession(storage);
    expect(loadStoredSession(0, storage)).toBeNull();
  });

  it('tolera storage que lança exceção ou ausente', () => {
    const throwing = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
      removeItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(() => storeSession({ token: 't', expiresAt: 1 }, throwing)).not.toThrow();
    expect(loadStoredSession(0, throwing)).toBeNull();
    expect(() => clearStoredSession(throwing)).not.toThrow();
    // sem sessionStorage global (ambiente Node): também não deve lançar
    expect(loadStoredSession(0)).toBeNull();
  });
});
