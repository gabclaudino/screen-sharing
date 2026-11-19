import { describe, expect, it, vi } from 'vitest';
import type { Config } from './config';
import {
  CloudflareIceProvider,
  createIceProvider,
  IceService,
  MeteredIceProvider,
  STUN_SERVERS,
  type IceProvider,
} from './ice';
import type { Logger } from './logger';

const TURN = {
  urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turns:turn.cloudflare.com:443'],
  username: 'user-efemero',
  credential: 'segredo-efemero',
};

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fakeLogger = (): Logger & { errors: unknown[][] } => {
  const errors: unknown[][] = [];
  return {
    errors,
    info: () => undefined,
    warn: () => undefined,
    error: (...args: unknown[]) => void errors.push(args),
  };
};

describe('CloudflareIceProvider', () => {
  it('faz POST em generate-ice-servers com Bearer e ttl, e devolve os servidores', async () => {
    const fetchImpl = vi.fn(async () => json({ iceServers: [TURN] }, 201));
    const provider = new CloudflareIceProvider('chave-id', 'token-api', 3600, fetchImpl);

    await expect(provider.getIceServers()).resolves.toEqual([TURN]);

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(
      'https://rtc.live.cloudflare.com/v1/turn/keys/chave-id/credentials/generate-ice-servers',
    );
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer token-api' });
    expect(JSON.parse(String(init.body))).toEqual({ ttl: 3600 });
  });

  it('aceita iceServers como objeto único (formato antigo)', async () => {
    const provider = new CloudflareIceProvider('k', 't', 60, async () =>
      json({ iceServers: TURN }),
    );
    await expect(provider.getIceServers()).resolves.toEqual([TURN]);
  });

  it('erro HTTP vira exceção sem vazar o corpo da resposta', async () => {
    const provider = new CloudflareIceProvider(
      'k',
      't',
      60,
      async () => new Response('conta-secreta-123', { status: 403 }),
    );
    const error = await provider.getIceServers().catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('403');
    expect((error as Error).message).not.toContain('conta-secreta-123');
  });

  it('formato inesperado vira exceção', async () => {
    const provider = new CloudflareIceProvider('k', 't', 60, async () => json({ nada: true }));
    await expect(provider.getIceServers()).rejects.toThrow(/formato inesperado/);
  });

  it('escapa o keyId na URL', async () => {
    const fetchImpl = vi.fn(async () => json({ iceServers: [TURN] }));
    await new CloudflareIceProvider('a/b c', 't', 60, fetchImpl).getIceServers();
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toContain('/keys/a%2Fb%20c/');
  });
});

describe('MeteredIceProvider', () => {
  it('faz GET em <app>.metered.live com apiKey e aceita lista solta', async () => {
    const fetchImpl = vi.fn(async () => json([{ urls: 'stun:stun.relay.metered.ca:80' }, TURN]));
    const provider = new MeteredIceProvider('meuapp', 'minha-chave', fetchImpl);

    await expect(provider.getIceServers()).resolves.toEqual([
      { urls: 'stun:stun.relay.metered.ca:80' },
      TURN,
    ]);
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://meuapp.metered.live/api/v1/turn/credentials?apiKey=minha-chave',
    );
  });

  it('HTTP 400 (chave inválida) vira exceção', async () => {
    const provider = new MeteredIceProvider('a', 'k', async () =>
      json({ error: 'Please specify API Key' }, 400),
    );
    await expect(provider.getIceServers()).rejects.toThrow(/400/);
  });
});

describe('createIceProvider', () => {
  const base = { credentialTtlSec: 3600 };

  it('devolve o provedor configurado ou null', () => {
    const cf: Config['ice'] = {
      ...base,
      provider: 'cloudflare',
      cloudflare: { keyId: 'k', apiToken: 't' },
    };
    const metered: Config['ice'] = {
      ...base,
      provider: 'metered',
      metered: { appName: 'a', apiKey: 'k' },
    };
    expect(createIceProvider(cf)).toBeInstanceOf(CloudflareIceProvider);
    expect(createIceProvider(metered)).toBeInstanceOf(MeteredIceProvider);
    expect(createIceProvider({ ...base, provider: 'none' })).toBeNull();
  });
});

describe('IceService', () => {
  const provider = (impl: () => Promise<unknown[]>): IceProvider & { calls: number } => {
    const p = {
      name: 'fake',
      calls: 0,
      getIceServers() {
        p.calls += 1;
        return impl() as Promise<never>;
      },
    };
    return p;
  };

  it('sem provedor devolve só STUN', async () => {
    const service = new IceService(null, { logger: fakeLogger() });
    await expect(service.getIceServers()).resolves.toEqual(STUN_SERVERS);
  });

  it('devolve STUN + TURN do provedor', async () => {
    const service = new IceService(
      provider(async () => [TURN]),
      { logger: fakeLogger() },
    );
    await expect(service.getIceServers()).resolves.toEqual([...STUN_SERVERS, TURN]);
  });

  it('reaproveita as credenciais dentro do cache e busca de novo depois dele', async () => {
    let now = 1_000;
    const p = provider(async () => [TURN]);
    const service = new IceService(p, { logger: fakeLogger(), cacheMs: 5_000, now: () => now });

    await service.getIceServers();
    now += 4_999;
    await service.getIceServers();
    expect(p.calls).toBe(1);

    now += 1;
    await service.getIceServers();
    expect(p.calls).toBe(2);
  });

  it('requisições simultâneas compartilham uma só chamada ao provedor', async () => {
    const p = provider(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return [TURN];
    });
    const service = new IceService(p, { logger: fakeLogger() });
    const results = await Promise.all([
      service.getIceServers(),
      service.getIceServers(),
      service.getIceServers(),
    ]);
    expect(p.calls).toBe(1);
    expect(results[0]).toEqual(results[2]);
  });

  it('falha do provedor: devolve só STUN (sem lançar), loga e não insiste logo em seguida', async () => {
    let now = 0;
    const logger = fakeLogger();
    const p = provider(async () => {
      throw new Error('cloudflare respondeu HTTP 500');
    });
    const service = new IceService(p, {
      logger,
      failureBackoffMs: 30_000,
      now: () => now,
    });

    await expect(service.getIceServers()).resolves.toEqual(STUN_SERVERS);
    expect(logger.errors).toHaveLength(1);

    now += 10_000;
    await expect(service.getIceServers()).resolves.toEqual(STUN_SERVERS);
    expect(p.calls).toBe(1); // dentro do backoff

    now += 20_001;
    await service.getIceServers();
    expect(p.calls).toBe(2); // tenta de novo depois do backoff
  });

  it('loga a causa de rede (error.cause.code) quando o fetch falha', async () => {
    const logger = fakeLogger();
    const p = provider(async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('x'), { code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' }),
      });
    });
    await new IceService(p, { logger }).getIceServers();
    expect(logger.errors[0]?.[1]).toMatchObject({
      provider: 'fake',
      message: 'fetch failed',
      cause: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
    });
  });

  it('se o provedor volta a funcionar, passa a entregar TURN', async () => {
    let now = 0;
    let ok = false;
    const p = provider(async () => {
      if (!ok) throw new Error('fora do ar');
      return [TURN];
    });
    const service = new IceService(p, {
      logger: fakeLogger(),
      failureBackoffMs: 1_000,
      now: () => now,
    });

    expect(await service.getIceServers()).toEqual(STUN_SERVERS);
    ok = true;
    now += 1_001;
    expect(await service.getIceServers()).toEqual([...STUN_SERVERS, TURN]);
  });
});
