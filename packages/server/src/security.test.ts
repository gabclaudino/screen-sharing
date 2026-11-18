import { describe, expect, it } from 'vitest';
import {
  buildCsp,
  createToken,
  getClientIp,
  isOriginAllowed,
  RateLimiter,
  verifyPassword,
  verifyToken,
} from './security';

const SECRET = 'x'.repeat(40);

describe('verifyPassword', () => {
  it('aceita a senha correta e rejeita as demais', () => {
    expect(verifyPassword('segredo-123', 'segredo-123')).toBe(true);
    expect(verifyPassword('segredo-124', 'segredo-123')).toBe(false);
    expect(verifyPassword('', 'segredo-123')).toBe(false);
    expect(verifyPassword('segredo-123-mais-longa', 'segredo-123')).toBe(false);
  });
});

describe('token de sessão', () => {
  const now = 1_700_000_000_000;

  it('cria e valida um token', () => {
    const { token, expiresAt } = createToken(SECRET, 'sessao-1', 3600, now);
    expect(expiresAt).toBe(now + 3600 * 1000);
    expect(verifyToken(token, SECRET, now + 1000)).toEqual({
      sid: 'sessao-1',
      exp: now / 1000 + 3600,
    });
  });

  it('rejeita token expirado', () => {
    const { token, expiresAt } = createToken(SECRET, 'sessao-1', 60, now);
    expect(verifyToken(token, SECRET, expiresAt - 1)).not.toBeNull();
    expect(verifyToken(token, SECRET, expiresAt)).toBeNull();
  });

  it('rejeita assinatura de outro segredo', () => {
    const { token } = createToken(SECRET, 'sessao-1', 3600, now);
    expect(verifyToken(token, 'y'.repeat(40), now)).toBeNull();
  });

  it('rejeita payload adulterado', () => {
    const { token } = createToken(SECRET, 'sessao-1', 3600, now);
    const [, signature] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sid: 'outro', exp: now / 1000 + 999999 })).toString(
      'base64url',
    );
    expect(verifyToken(`${forged}.${signature}`, SECRET, now)).toBeNull();
  });

  it('rejeita formatos inválidos', () => {
    for (const token of ['', 'abc', 'a.b.c', '.', 'a.', '.b', '%%%.%%%']) {
      expect(verifyToken(token, SECRET, now)).toBeNull();
    }
  });
});

describe('RateLimiter', () => {
  it('bloqueia depois do limite dentro da janela e libera na janela seguinte', () => {
    const limiter = new RateLimiter(3, 1000);
    expect([1, 2, 3, 4, 5].map(() => limiter.hit('ip', 0))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(limiter.hit('ip', 999)).toBe(false);
    expect(limiter.hit('ip', 1000)).toBe(true);
  });

  it('conta cada chave separadamente', () => {
    const limiter = new RateLimiter(1, 1000);
    expect(limiter.hit('a', 0)).toBe(true);
    expect(limiter.hit('a', 1)).toBe(false);
    expect(limiter.hit('b', 1)).toBe(true);
  });

  it('sweep remove janelas expiradas', () => {
    const limiter = new RateLimiter(1, 1000);
    limiter.hit('a', 0);
    limiter.hit('a', 1);
    limiter.sweep(1000);
    expect(limiter.hit('a', 1001)).toBe(true);
  });
});

describe('getClientIp', () => {
  const req = (remoteAddress: string | undefined, header?: string) => ({
    headers: header === undefined ? {} : { 'cf-connecting-ip': header },
    socket: { remoteAddress },
  });

  it('usa CF-Connecting-IP apenas quando a conexão vem do loopback', () => {
    expect(getClientIp(req('127.0.0.1', '203.0.113.7') as never)).toBe('203.0.113.7');
    expect(getClientIp(req('::1', '203.0.113.7') as never)).toBe('203.0.113.7');
    expect(getClientIp(req('::ffff:127.0.0.1', '203.0.113.7') as never)).toBe('203.0.113.7');
  });

  it('ignora o header (spoofável) quando a conexão não é do loopback', () => {
    expect(getClientIp(req('198.51.100.9', '203.0.113.7') as never)).toBe('198.51.100.9');
  });

  it('usa o IP do socket sem header', () => {
    expect(getClientIp(req('127.0.0.1') as never)).toBe('127.0.0.1');
    expect(getClientIp(req(undefined) as never)).toBe('unknown');
  });
});

describe('isOriginAllowed', () => {
  const prod = { allowedOrigin: 'https://share.example.com', nodeEnv: 'production' as const };
  const dev = { ...prod, nodeEnv: 'development' as const };

  it('aceita só a origem configurada em produção', () => {
    expect(isOriginAllowed('https://share.example.com', prod)).toBe(true);
    expect(isOriginAllowed('https://evil.example.com', prod)).toBe(false);
    expect(isOriginAllowed('http://localhost:5173', prod)).toBe(false);
  });

  it('rejeita Origin ausente', () => {
    expect(isOriginAllowed(undefined, prod)).toBe(false);
  });

  it('aceita a origem do Vite em desenvolvimento', () => {
    expect(isOriginAllowed('http://localhost:5173', dev)).toBe(true);
    expect(isOriginAllowed('http://evil.example.com', dev)).toBe(false);
  });
});

describe('buildCsp', () => {
  it('lista o wss:// da origem permitida em connect-src', () => {
    const csp = buildCsp('https://share.example.com');
    expect(csp).toContain("connect-src 'self' wss://share.example.com");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('usa ws:// quando a origem é http', () => {
    expect(buildCsp('http://localhost:3000')).toContain('ws://localhost:3000');
  });
});
