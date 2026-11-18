import { iceServersResponseSchema } from '@screenshare/shared';
import type { Session } from './auth';

/** Só STUN público: usado se o servidor não responder (conexões diretas ainda funcionam). */
export const FALLBACK_ICE_SERVERS: RTCIceServer[] = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
];

/** GET /api/ice com o token de sessão. Lança se a resposta não for utilizável. */
export async function fetchIceServers(
  token: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<RTCIceServer[]> {
  const response = await fetchImpl('/api/ice', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`/api/ice respondeu HTTP ${response.status}`);
  const parsed = iceServersResponseSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.iceServers.length === 0) {
    throw new Error('/api/ice devolveu um formato inesperado');
  }
  return parsed.data.iceServers;
}

export interface IceServerStoreOptions {
  getSession: () => Session | null;
  fetchImpl?: typeof fetch;
  /** Chamado quando passa a usar (ou deixa de usar) o fallback só-STUN. */
  onFallbackChange?: (fallback: boolean) => void;
  /** Renovação periódica; só afeta conexões criadas depois (padrão 25 min). */
  refreshMs?: number;
}

/**
 * Guarda os iceServers atuais. `refresh()` nunca lança: se a busca falhar, cai para STUN e
 * avisa (`onFallbackChange(true)`), para a UI explicar que redes restritivas podem falhar.
 */
export class IceServerStore {
  private servers: RTCIceServer[] = FALLBACK_ICE_SERVERS;
  private fallback = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly opts: IceServerStoreOptions;

  constructor(options: IceServerStoreOptions) {
    this.opts = options;
  }

  get(): RTCIceServer[] {
    return this.servers;
  }

  get usingFallback(): boolean {
    return this.fallback;
  }

  async refresh(): Promise<void> {
    const session = this.opts.getSession();
    try {
      if (!session) throw new Error('sem sessão');
      this.servers = await fetchIceServers(session.token, this.opts.fetchImpl);
      this.setFallback(false);
    } catch (error) {
      console.warn('[ice] usando só STUN:', error instanceof Error ? error.message : error);
      this.servers = FALLBACK_ICE_SERVERS;
      this.setFallback(true);
    }
  }

  /** Renova em segundo plano enquanto a sala estiver aberta. */
  startAutoRefresh(): void {
    this.stop();
    this.timer = setInterval(() => void this.refresh(), this.opts.refreshMs ?? 25 * 60_000);
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private setFallback(fallback: boolean): void {
    if (this.fallback === fallback) return;
    this.fallback = fallback;
    this.opts.onFallbackChange?.(fallback);
  }
}
