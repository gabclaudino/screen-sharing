import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import type { Config } from './config';

// ---------------------------------------------------------------------------
// Senha
// ---------------------------------------------------------------------------

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest();

/** Comparação em tempo constante; compara hashes para não vazar o comprimento da senha. */
export function verifyPassword(candidate: string, expected: string): boolean {
  return timingSafeEqual(sha256(candidate), sha256(expected));
}

// ---------------------------------------------------------------------------
// Token de sessão: base64url(payload) + "." + base64url(HMAC-SHA256)
// ---------------------------------------------------------------------------

const payloadSchema = z.object({
  // Identifica a sessão de login (usado para expulsar conexão antiga do mesmo usuário).
  sid: z.string().min(1).max(64),
  // Expiração em segundos desde a epoch.
  exp: z.number().int(),
});
export type SessionPayload = z.infer<typeof payloadSchema>;

const sign = (body: string, secret: string): Buffer =>
  createHmac('sha256', secret).update(body).digest();

export function createToken(
  secret: string,
  sid: string,
  ttlSec: number,
  nowMs: number = Date.now(),
): { token: string; expiresAt: number } {
  const exp = Math.floor(nowMs / 1000) + ttlSec;
  const body = Buffer.from(JSON.stringify({ sid, exp }), 'utf8').toString('base64url');
  const signature = sign(body, secret).toString('base64url');
  return { token: `${body}.${signature}`, expiresAt: exp * 1000 };
}

export function verifyToken(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): SessionPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, signature] = parts;
  if (!body || !signature) return null;

  const expected = sign(body, secret);
  const received = Buffer.from(signature, 'base64url');
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return null;

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success || parsed.data.exp * 1000 <= nowMs) return null;
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Rate limit (janela fixa por chave)
// ---------------------------------------------------------------------------

export class RateLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();
  private readonly max: number;
  private readonly windowMs: number;

  constructor(max: number, windowMs: number) {
    this.max = max;
    this.windowMs = windowMs;
  }

  /** Registra uma tentativa; devolve `false` quando o limite da janela foi excedido. */
  hit(key: string, now: number = Date.now()): boolean {
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    entry.count += 1;
    return entry.count <= this.max;
  }

  /** Remove janelas expiradas (evita crescimento ilimitado do mapa). */
  sweep(now: number = Date.now()): void {
    for (const [key, entry] of this.entries) {
      if (entry.resetAt <= now) this.entries.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// IP do cliente e origin
// ---------------------------------------------------------------------------

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * `CF-Connecting-IP` só é confiável quando a conexão vem do loopback (o `cloudflared`);
 * de qualquer outro endereço o header seria spoofável, então usamos o IP do socket.
 */
export function getClientIp(req: Pick<IncomingMessage, 'headers' | 'socket'>): string {
  const remote = req.socket.remoteAddress ?? 'unknown';
  const header = req.headers['cf-connecting-ip'];
  if (
    LOOPBACK.has(remote) &&
    typeof header === 'string' &&
    header.length > 0 &&
    header.length <= 64
  ) {
    return header.trim();
  }
  return remote;
}

const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

/** Em dev também é aceita a origem do Vite. Origin ausente é sempre rejeitado. */
export function isOriginAllowed(
  origin: string | undefined,
  config: Pick<Config, 'allowedOrigin' | 'nodeEnv'>,
): boolean {
  if (origin === undefined) return false;
  if (origin === config.allowedOrigin) return true;
  return config.nodeEnv === 'development' && DEV_ORIGINS.includes(origin);
}

// ---------------------------------------------------------------------------
// Cabeçalhos de segurança
// ---------------------------------------------------------------------------

export function buildCsp(allowedOrigin: string): string {
  const url = new URL(allowedOrigin);
  // `wss://` explícito: alguns navegadores não tratam 'self' como cobrindo WebSocket.
  const wsOrigin = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "media-src 'self' blob:",
    `connect-src 'self' ${wsOrigin}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
}

export function applySecurityHeaders(
  res: ServerResponse,
  config: Pick<Config, 'allowedOrigin'>,
): void {
  res.setHeader('Content-Security-Policy', buildCsp(config.allowedOrigin));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'display-capture=(self)');
}
