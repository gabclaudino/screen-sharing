import { iceServerSchema, type IceServer } from '@screenshare/shared';
import { z } from 'zod';
import type { Config } from './config';
import type { Logger } from './logger';

/** STUN público: sempre incluído, mesmo sem TURN configurado (dev local). */
export const STUN_SERVERS: IceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

/** Um provedor de TURN devolve servidores com credenciais de curta duração. */
export interface IceProvider {
  readonly name: string;
  getIceServers(): Promise<IceServer[]>;
}

type FetchLike = typeof fetch;

const REQUEST_TIMEOUT_MS = 5_000;

/** Aceita `{ iceServers: [...] }`, `{ iceServers: {...} }` ou uma lista solta. */
const providerResponseSchema = z
  .union([
    z.object({ iceServers: z.union([z.array(iceServerSchema), iceServerSchema]) }),
    z.array(iceServerSchema),
  ])
  .transform((value): IceServer[] => {
    const servers = Array.isArray(value) ? value : value.iceServers;
    return Array.isArray(servers) ? servers : [servers];
  });

async function readServers(response: Response, provider: string): Promise<IceServer[]> {
  if (!response.ok) {
    // Não inclui o corpo na mensagem: pode conter detalhes da conta.
    throw new Error(`${provider} respondeu HTTP ${response.status}`);
  }
  const parsed = providerResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error(`${provider} devolveu um formato inesperado`);
  return parsed.data;
}

/** Cloudflare Realtime TURN: credenciais efêmeras via API. */
export class CloudflareIceProvider implements IceProvider {
  readonly name = 'cloudflare';

  constructor(
    private readonly keyId: string,
    private readonly apiToken: string,
    private readonly ttlSec: number,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async getIceServers(): Promise<IceServer[]> {
    const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(
      this.keyId,
    )}/credentials/generate-ice-servers`;
    const response = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: this.ttlSec }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    return readServers(response, 'cloudflare');
  }
}

/** Metered.ca: lista de servidores com credenciais do app, via API de credenciais. */
export class MeteredIceProvider implements IceProvider {
  readonly name = 'metered';

  constructor(
    private readonly appName: string,
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async getIceServers(): Promise<IceServer[]> {
    const url = `https://${encodeURIComponent(this.appName)}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(
      this.apiKey,
    )}`;
    const response = await this.fetchImpl(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return readServers(response, 'metered');
  }
}

export function createIceProvider(
  ice: Config['ice'],
  fetchImpl: FetchLike = fetch,
): IceProvider | null {
  if (ice.provider === 'cloudflare' && ice.cloudflare) {
    return new CloudflareIceProvider(
      ice.cloudflare.keyId,
      ice.cloudflare.apiToken,
      ice.credentialTtlSec,
      fetchImpl,
    );
  }
  if (ice.provider === 'metered' && ice.metered) {
    return new MeteredIceProvider(ice.metered.appName, ice.metered.apiKey, fetchImpl);
  }
  return null;
}

export interface IceServiceOptions {
  logger: Logger;
  /** Por quanto tempo reaproveitar as credenciais já obtidas (padrão 5 min). */
  cacheMs?: number;
  /** Depois de uma falha, não insiste no provedor por este tempo (padrão 30 s). */
  failureBackoffMs?: number;
  now?: () => number;
}

/**
 * Entrega os iceServers ao cliente: STUN + TURN do provedor. A chave do provedor fica só aqui.
 * Nunca falha: se o provedor cair, devolve só STUN para a sala continuar entre quem consegue P2P.
 */
export class IceService {
  private readonly provider: IceProvider | null;
  private readonly logger: Logger;
  private readonly cacheMs: number;
  private readonly failureBackoffMs: number;
  private readonly now: () => number;

  private cached: { servers: IceServer[]; expiresAt: number } | null = null;
  private failedUntil = 0;
  private inflight: Promise<IceServer[]> | null = null;

  constructor(provider: IceProvider | null, options: IceServiceOptions) {
    this.provider = provider;
    this.logger = options.logger;
    this.cacheMs = options.cacheMs ?? 5 * 60_000;
    this.failureBackoffMs = options.failureBackoffMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  async getIceServers(): Promise<IceServer[]> {
    if (!this.provider) return STUN_SERVERS;

    const now = this.now();
    if (this.cached && this.cached.expiresAt > now) return this.cached.servers;
    if (now < this.failedUntil) return STUN_SERVERS;

    // Várias requisições simultâneas compartilham a mesma chamada ao provedor.
    this.inflight ??= this.fetchFromProvider(this.provider).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  private async fetchFromProvider(provider: IceProvider): Promise<IceServer[]> {
    try {
      const turn = await provider.getIceServers();
      const servers = [...STUN_SERVERS, ...turn];
      this.cached = { servers, expiresAt: this.now() + this.cacheMs };
      return servers;
    } catch (error) {
      this.failedUntil = this.now() + this.failureBackoffMs;
      // `fetch failed` sozinho não diz nada: a causa (ex.: UNABLE_TO_GET_ISSUER_CERT_LOCALLY
      // quando um antivírus inspeciona o HTTPS, ENOTFOUND, ETIMEDOUT) vem em `error.cause`.
      const cause =
        error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
      this.logger.error('ice_provider_failed', {
        provider: provider.name,
        message: error instanceof Error ? error.message : 'unknown',
        ...(typeof cause?.code === 'string' ? { cause: cause.code } : {}),
      });
      return STUN_SERVERS;
    }
  }
}
