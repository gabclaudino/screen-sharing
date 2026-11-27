import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  connectionReportSchema,
  loginRequestSchema,
  MAX_WS_MESSAGE_BYTES,
  type LoginResponse,
} from '@screenshare/shared';
import { WebSocketServer } from 'ws';
import type { Config } from './config';
import { silentLogger, type Logger } from './logger';
import { createSignaling } from './signaling';
import {
  applySecurityHeaders,
  createToken,
  getClientIp,
  isOriginAllowed,
  RateLimiter,
  verifyPassword,
  verifyToken,
} from './security';
import { createStaticHandler } from './static';
import { createIceProvider, IceService } from './ice';

export interface AppOptions {
  logger?: Logger;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  /** Substitui o fetch usado para falar com o provedor de TURN (testes). */
  fetchImpl?: typeof fetch;
  /** Por quanto tempo reaproveitar as credenciais TURN (padrão 5 min). */
  iceCacheMs?: number;
  /** Limites de conexões WS e prazo para o join (ver createSignaling). */
  maxConnectionsPerSession?: number;
  maxConnections?: number;
  joinTimeoutMs?: number;
  /** Duração do giro da roleta (testes). */
  rouletteSpinMs?: number;
  /** Identifica esta execução do servidor (padrão: aleatório); só os testes fixam. */
  bootId?: string;
}

const MAX_LOGIN_BODY_BYTES = 1024;
const MAX_REPORT_BODY_BYTES = 2048;
// Relatos de conexão por login e por minuto (sala cheia reconectando várias vezes cabe com folga).
const REPORTS_PER_MINUTE = 120;

class PayloadTooLargeError extends Error {}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function readBody(req: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > maxBytes) {
        // Para de acumular e rejeita, mas segue consumindo o corpo para poder responder 413.
        tooLarge = true;
        chunks.length = 0;
        reject(new PayloadTooLargeError());
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Monta o servidor HTTP (estáticos + /api/login) e o WS (/ws) na mesma origem.
 * Não chama `listen`: quem cria decide (index.ts em produção, porta 0 nos testes).
 */
export function createApp(config: Config, options: AppOptions = {}) {
  const logger = options.logger ?? silentLogger;
  // Cada subida do servidor assina os logins com uma chave nova: quem entrou antes de um
  // desligamento/reinício precisa digitar a senha de novo (o token antigo deixa de valer).
  const signingSecret = `${config.sessionSecret}:${options.bootId ?? randomUUID()}`;
  const signaling = createSignaling({
    config,
    logger,
    heartbeatIntervalMs: options.heartbeatIntervalMs ?? 15_000,
    heartbeatTimeoutMs: options.heartbeatTimeoutMs ?? 60_000,
    ...(options.maxConnectionsPerSession === undefined
      ? {}
      : { maxConnectionsPerSession: options.maxConnectionsPerSession }),
    ...(options.maxConnections === undefined ? {} : { maxConnections: options.maxConnections }),
    ...(options.rouletteSpinMs === undefined ? {} : { rouletteSpinMs: options.rouletteSpinMs }),
    ...(options.joinTimeoutMs === undefined ? {} : { joinTimeoutMs: options.joinTimeoutMs }),
  });
  const iceService = new IceService(createIceProvider(config.ice, options.fetchImpl), {
    logger,
    ...(options.iceCacheMs === undefined ? {} : { cacheMs: options.iceCacheMs }),
  });
  const serveStatic = createStaticHandler(config.staticDir);
  const loginLimiter = new RateLimiter(config.loginRateMax, config.loginRateWindowMs);
  const reportLimiter = new RateLimiter(REPORTS_PER_MINUTE, 60_000);
  const sweeper = setInterval(() => {
    loginLimiter.sweep();
    reportLimiter.sweep();
  }, 60_000);
  sweeper.unref();

  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WS_MESSAGE_BYTES,
    perMessageDeflate: false,
  });

  async function handleLogin(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!loginLimiter.hit(getClientIp(req))) {
      logger.warn('login_rate_limited');
      sendJson(res, 429, { error: 'RATE_LIMITED' });
      return;
    }
    // Navegadores sempre mandam Origin em POST cross-origin; clientes sem Origin passam.
    const origin = req.headers.origin;
    if (origin !== undefined && !isOriginAllowed(origin, config)) {
      sendJson(res, 403, { error: 'FORBIDDEN' });
      return;
    }
    // Exigir JSON impede "simple requests" cross-site (forçam preflight, que não liberamos).
    if (!req.headers['content-type']?.toLowerCase().startsWith('application/json')) {
      sendJson(res, 415, { error: 'UNSUPPORTED_MEDIA_TYPE' });
      return;
    }

    let body: unknown;
    try {
      body = JSON.parse(await readBody(req, MAX_LOGIN_BODY_BYTES));
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        // Fecha a conexão depois da resposta para não ficar recebendo um corpo gigante.
        res.setHeader('Connection', 'close');
        res.once('finish', () => req.destroy());
        sendJson(res, 413, { error: 'PAYLOAD_TOO_LARGE' });
      } else {
        sendJson(res, 400, { error: 'INVALID' });
      }
      return;
    }
    const parsed = loginRequestSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, { error: 'INVALID' });
      return;
    }
    if (!verifyPassword(parsed.data.password, config.accessPassword)) {
      logger.warn('login_failed');
      sendJson(res, 401, { error: 'BAD_PASSWORD' });
      return;
    }

    const { token, expiresAt } = createToken(signingSecret, randomUUID(), config.sessionTtlSec);
    logger.info('login');
    const response: LoginResponse = { token, expiresAt };
    sendJson(res, 200, response);
  }

  // Só quem já fez login recebe as credenciais TURN (token no header, nunca na URL).
  async function handleIce(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || !verifyToken(token, signingSecret)) {
      sendJson(res, 401, { error: 'UNAUTHORIZED' });
      return;
    }
    // Nunca 5xx por falha do provedor: o IceService já cai para só STUN.
    sendJson(res, 200, { iceServers: await iceService.getIceServers() });
  }

  // O cliente pergunta, antes de reconectar depois de uma queda, se o login ainda vale (200) ou
  // se o servidor foi desligado e religado nesse meio-tempo (401: voltar à tela de entrada).
  function handleSession(req: IncomingMessage, res: ServerResponse): void {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token || !verifyToken(token, signingSecret)) {
      sendJson(res, 401, { error: 'UNAUTHORIZED' });
      return;
    }
    sendJson(res, 200, { ok: true });
  }

  // Diagnóstico das conexões entre navegadores: vira uma linha `webrtc` no log, com os nomes.
  async function handleReport(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const header = req.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const session = token ? verifyToken(token, signingSecret) : null;
    if (!session) {
      sendJson(res, 401, { error: 'UNAUTHORIZED' });
      return;
    }
    if (!reportLimiter.hit(session.sid)) {
      sendJson(res, 429, { error: 'RATE_LIMITED' });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req, MAX_REPORT_BODY_BYTES));
    } catch (error) {
      if (error instanceof PayloadTooLargeError) {
        res.setHeader('Connection', 'close');
        res.once('finish', () => req.destroy());
        sendJson(res, 413, { error: 'PAYLOAD_TOO_LARGE' });
      } else {
        sendJson(res, 400, { error: 'INVALID' });
      }
      return;
    }
    const parsed = connectionReportSchema.safeParse(body);
    if (!parsed.success) {
      sendJson(res, 400, { error: 'INVALID' });
      return;
    }
    const { self, peer, event, ...details } = parsed.data;
    const from = signaling.identify(self);
    // Cada login só relata as próprias conexões.
    if (!from || from.sid !== session.sid) {
      sendJson(res, 403, { error: 'FORBIDDEN' });
      return;
    }
    logger[event === 'connected' ? 'info' : 'warn']('webrtc', {
      state: event,
      from: from.name,
      to: signaling.identify(peer)?.name ?? '?',
      self,
      peer,
      ...details,
    });
    res.writeHead(204, { 'Cache-Control': 'no-store' });
    res.end();
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    applySecurityHeaders(res, config);
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');

    if (pathname === '/api/login') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
        return;
      }
      await handleLogin(req, res);
      return;
    }
    if (pathname === '/api/ice') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
        return;
      }
      await handleIce(req, res);
      return;
    }
    if (pathname === '/api/session') {
      if (req.method !== 'GET') {
        res.setHeader('Allow', 'GET');
        sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
        return;
      }
      handleSession(req, res);
      return;
    }
    if (pathname === '/api/report') {
      if (req.method !== 'POST') {
        res.setHeader('Allow', 'POST');
        sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
        return;
      }
      await handleReport(req, res);
      return;
    }
    // Rotas /api/* desconhecidas nunca caem no fallback SPA.
    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { error: 'NOT_FOUND' });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    await serveStatic(req, res, pathname);
  }

  const server: Server = createServer((req, res) => {
    handleRequest(req, res).catch((error: unknown) => {
      logger.error('request_error', {
        message: error instanceof Error ? error.message : 'unknown',
      });
      if (res.headersSent) {
        res.destroy();
      } else {
        sendJson(res, 500, { error: 'INTERNAL' });
      }
    });
  });

  // Timeouts contra clientes lentos/travados (slowloris). O keep-alive fica acima dos ~90 s em que
  // o cloudflared reaproveita conexões, senão ele reutiliza um socket que o Node já fechou (502).
  server.keepAliveTimeout = 95_000;
  server.headersTimeout = 100_000;
  server.requestTimeout = 30_000;

  const rejectUpgrade = (socket: Duplex, status: number, text: string): void => {
    socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    socket.destroy();
  };

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => socket.destroy());
    // Não logar req.url: o token vai na query string.
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      // Um throw aqui, fora de qualquer try/catch, derrubaria o processo todo.
      rejectUpgrade(socket, 400, 'Bad Request');
      return;
    }
    if (url.pathname !== '/ws') {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }
    if (!isOriginAllowed(req.headers.origin, config)) {
      logger.warn('ws_origin_rejected');
      rejectUpgrade(socket, 403, 'Forbidden');
      return;
    }
    const token = url.searchParams.get('token');
    const session = token ? verifyToken(token, signingSecret) : null;
    if (!session) {
      rejectUpgrade(socket, 401, 'Unauthorized');
      return;
    }
    if (!signaling.canAccept(session.sid)) {
      logger.warn('ws_connection_limit');
      rejectUpgrade(socket, 429, 'Too Many Requests');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      signaling.handleConnection(ws, { sid: session.sid });
    });
  });

  const close = async (): Promise<void> => {
    clearInterval(sweeper);
    signaling.close();
    wss.close();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  };

  return { server, close, signaling };
}
