import { describe, expect, it } from 'vitest';
import { isSessionValid, login, LoginError } from './auth';

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

describe('isSessionValid', () => {
  it('manda o token por Bearer em GET /api/session', async () => {
    let captured: { url: string; init: RequestInit | undefined } | undefined;
    const fetchImpl = ((url: string, init?: RequestInit) => {
      captured = { url, init };
      return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
    }) as typeof fetch;
    await expect(isSessionValid('tok', fetchImpl)).resolves.toBe(true);
    expect(captured?.url).toBe('/api/session');
    expect(captured?.init?.headers).toEqual({ Authorization: 'Bearer tok' });
  });

  it('só o 401 (servidor religado ou token expirado) conta como inválido', async () => {
    await expect(isSessionValid('tok', respond(401))).resolves.toBe(false);
    for (const status of [200, 500, 502, 503]) {
      await expect(isSessionValid('tok', respond(status))).resolves.toBe(true);
    }
  });

  it('rede fora do ar conta como "ainda vale" (a reconexão segue tentando)', async () => {
    const failing = (() => Promise.reject(new TypeError('fetch failed'))) as typeof fetch;
    await expect(isSessionValid('tok', failing)).resolves.toBe(true);
  });
});
