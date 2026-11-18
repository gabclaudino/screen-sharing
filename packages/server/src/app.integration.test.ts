import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseServerMessage, type ServerMessage } from '@screenshare/shared';
import { WebSocket } from 'ws';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type AppOptions } from './app';
import { loadConfig } from './config';
import { createToken } from './security';

const ORIGIN = 'http://localhost:3000';
const PASSWORD = 'senha-de-teste-123';
const SECRET = 's'.repeat(40);

let staticDir: string;

beforeAll(() => {
  staticDir = mkdtempSync(path.join(tmpdir(), 'screenshare-static-'));
  mkdirSync(path.join(staticDir, 'assets'));
  writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>app</title>');
  writeFileSync(path.join(staticDir, 'assets', 'app-abc123.js'), 'console.log(1);');
});

afterAll(() => {
  rmSync(staticDir, { recursive: true, force: true });
});

function makeConfig(extra: Record<string, string> = {}) {
  return loadConfig({
    NODE_ENV: 'development',
    ALLOWED_ORIGIN: ORIGIN,
    ACCESS_PASSWORD: PASSWORD,
    SESSION_SECRET: SECRET,
    MAX_PEERS_PER_ROOM: '3',
    LOGIN_RATE_MAX: '100',
    STATIC_DIR: staticDir,
    ...extra,
  });
}

async function startApp(extra: Record<string, string> = {}, options: AppOptions = {}) {
  const app = createApp(makeConfig(extra), options);
  await new Promise<void>((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const port = (app.server.address() as AddressInfo).port;
  return { app, port, http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/ws` };
}

type Running = Awaited<ReturnType<typeof startApp>>;

async function login(running: Running, password = PASSWORD): Promise<Response> {
  return fetch(`${running.http}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: ORIGIN },
    body: JSON.stringify({ password }),
  });
}

async function getToken(running: Running): Promise<string> {
  const body = (await (await login(running)).json()) as { token: string };
  return body.token;
}

/** Cliente WS de teste que enfileira mensagens para não perder nenhuma. */
class TestClient {
  private readonly queue: ServerMessage[] = [];
  private readonly waiters: ((message: ServerMessage) => void)[] = [];
  readonly closed: Promise<{ code: number }>;

  private constructor(readonly socket: WebSocket) {
    socket.on('message', (data) => {
      const parsed = parseServerMessage(data.toString());
      if (!parsed.ok) throw new Error(`mensagem inválida do servidor: ${parsed.reason}`);
      const waiter = this.waiters.shift();
      if (waiter) waiter(parsed.message);
      else this.queue.push(parsed.message);
    });
    this.closed = new Promise((resolve) => socket.on('close', (code) => resolve({ code })));
  }

  static async connect(running: Running, token: string, origin = ORIGIN): Promise<TestClient> {
    const socket = new WebSocket(`${running.ws}?token=${encodeURIComponent(token)}`, {
      headers: { Origin: origin },
    });
    const client = new TestClient(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    return client;
  }

  send(message: unknown): void {
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  next(timeoutMs = 2000): Promise<ServerMessage> {
    const queued = this.queue.shift();
    if (queued) return Promise.resolve(queued);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout esperando mensagem')), timeoutMs);
      this.waiters.push((message) => {
        clearTimeout(timer);
        resolve(message);
      });
    });
  }

  async expectSilence(ms = 150): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
    expect(this.queue).toEqual([]);
  }

  async join(name: string, extra: object = {}) {
    this.send({ type: 'join', name, ...extra });
    const message = await this.next();
    if (message.type !== 'joined') throw new Error(`esperava joined, veio ${message.type}`);
    return message;
  }

  close(): void {
    this.socket.close();
  }
}

/** Devolve o status HTTP de um upgrade recusado. */
function upgradeStatus(url: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers });
    socket.on('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      socket.terminate();
    });
    socket.on('open', () => {
      socket.close();
      reject(new Error('o upgrade deveria ter sido recusado'));
    });
    socket.on('error', () => undefined);
  });
}

describe('servidor (HTTP)', () => {
  let running: Running;
  beforeAll(async () => {
    running = await startApp();
  });
  afterAll(async () => {
    await running.app.close();
  });

  it('login com senha correta devolve token e validade', async () => {
    const res = await login(running);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; expiresAt: number };
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.expiresAt).toBeGreaterThan(Date.now());
  });

  it('login com senha errada → 401', async () => {
    const res = await login(running, 'errada');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'BAD_PASSWORD' });
  });

  it('login com origem não permitida → 403', async () => {
    const res = await fetch(`${running.http}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example.com' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(res.status).toBe(403);
  });

  it('login exige JSON válido e content-type correto', async () => {
    const wrongType = await fetch(`${running.http}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ password: PASSWORD }),
    });
    expect(wrongType.status).toBe(415);

    const badBody = await fetch(`${running.http}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{nope',
    });
    expect(badBody.status).toBe(400);

    const extraField = await fetch(`${running.http}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: PASSWORD, extra: 1 }),
    });
    expect(extraField.status).toBe(400);
  });

  it('login rejeita corpo grande demais → 413', async () => {
    const res = await fetch(`${running.http}/api/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'a'.repeat(5000) }),
    });
    expect(res.status).toBe(413);
  });

  it('GET em /api/login → 405 e /api/* desconhecida → 404 (sem fallback SPA)', async () => {
    expect((await fetch(`${running.http}/api/login`)).status).toBe(405);
    const unknown = await fetch(`${running.http}/api/nada`);
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('content-type')).toContain('application/json');
  });

  it('aplica o limite de tentativas de login por IP → 429', async () => {
    const limited = await startApp({ LOGIN_RATE_MAX: '3' });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 5; i++) statuses.push((await login(limited, 'errada')).status);
      expect(statuses).toEqual([401, 401, 401, 429, 429]);
    } finally {
      await limited.app.close();
    }
  });

  it('serve index.html, assets com cache longo e fallback SPA', async () => {
    const index = await fetch(`${running.http}/`);
    expect(index.status).toBe(200);
    expect(index.headers.get('content-type')).toContain('text/html');
    expect(index.headers.get('cache-control')).toBe('no-cache');
    expect(await index.text()).toContain('<title>app</title>');

    const asset = await fetch(`${running.http}/assets/app-abc123.js`);
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect(asset.headers.get('content-type')).toContain('javascript');

    const spa = await fetch(`${running.http}/sala/abc`);
    expect(spa.status).toBe(200);
    expect(await spa.text()).toContain('<title>app</title>');

    expect((await fetch(`${running.http}/assets/nao-existe.js`)).status).toBe(404);
  });

  it('não permite path traversal nos estáticos', async () => {
    for (const url of ['/..%2f..%2fpackage.json', '/..%5c..%5cpackage.json', '/%00']) {
      const res = await fetch(`${running.http}${url}`);
      expect([400, 404]).toContain(res.status);
      expect(await res.text()).not.toContain('screenshare-mesh');
    }
  });

  it('envia cabeçalhos de segurança', async () => {
    const res = await fetch(`${running.http}/`);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('permissions-policy')).toBe('display-capture=(self)');
  });

  it('métodos não permitidos nos estáticos → 405', async () => {
    expect((await fetch(`${running.http}/`, { method: 'DELETE' })).status).toBe(405);
  });
});

describe('servidor (WebSocket)', () => {
  // Só existe uma sala: cada teste sobe um servidor novo para não herdar participantes.
  let running: Running;
  beforeEach(async () => {
    running = await startApp();
  });
  afterEach(async () => {
    await running.app.close();
  });

  it('recusa upgrade sem token, com token inválido ou expirado → 401', async () => {
    const headers = { Origin: ORIGIN };
    expect(await upgradeStatus(running.ws, headers)).toBe(401);
    expect(await upgradeStatus(`${running.ws}?token=lixo`, headers)).toBe(401);
    const expired = createToken(SECRET, 'sid', 60, Date.now() - 3600_000).token;
    expect(await upgradeStatus(`${running.ws}?token=${expired}`, headers)).toBe(401);
  });

  it('recusa upgrade com origem inválida ou ausente → 403', async () => {
    const token = await getToken(running);
    expect(
      await upgradeStatus(`${running.ws}?token=${token}`, { Origin: 'https://evil.example.com' }),
    ).toBe(403);
    expect(await upgradeStatus(`${running.ws}?token=${token}`, {})).toBe(403);
  });

  it('recusa upgrade em outro caminho → 404', async () => {
    const token = await getToken(running);
    const url = `${running.ws.replace('/ws', '/outro')}?token=${token}`;
    expect(await upgradeStatus(url, { Origin: ORIGIN })).toBe(404);
  });

  it('fluxo join / peer-joined / signal / peer-sharing / peer-left com 3 clientes', async () => {
    const [a, b, c] = await Promise.all(
      [0, 1, 2].map(async () => TestClient.connect(running, await getToken(running))),
    );
    if (!a || !b || !c) throw new Error('conexão falhou');

    const joinedA = await a.join('Ana');
    expect(joinedA.peers).toEqual([]);

    const joinedB = await b.join('Bia');
    expect(joinedB.peers).toEqual([{ id: joinedA.selfId, name: 'Ana', sharing: false }]);
    const peerJoined = await a.next();
    expect(peerJoined).toEqual({
      type: 'peer-joined',
      peer: { id: joinedB.selfId, name: 'Bia', sharing: false },
    });

    const joinedC = await c.join('Caio');
    expect(joinedC.peers.map((p) => p.name).sort()).toEqual(['Ana', 'Bia']);
    await a.next(); // peer-joined (Caio)
    await b.next();

    // signal: só o destinatário recebe, com `from` definido pelo servidor
    const data = { gen: 0, description: { type: 'offer', sdp: 'v=0' } };
    a.send({ type: 'signal', to: joinedB.selfId, data });
    expect(await b.next()).toEqual({ type: 'signal', from: joinedA.selfId, data });
    await c.expectSilence();

    // sharing: todos os outros são avisados
    a.send({ type: 'sharing', active: true });
    expect(await b.next()).toEqual({ type: 'peer-sharing', id: joinedA.selfId, active: true });
    expect(await c.next()).toEqual({ type: 'peer-sharing', id: joinedA.selfId, active: true });

    // quem entra depois já vê o estado de sharing
    const d = await TestClient.connect(running, await getToken(running));
    c.close();
    await a.next(); // peer-left (Caio)
    await b.next();
    const joinedD = await d.join('Duda');
    expect(joinedD.peers.find((p) => p.name === 'Ana')?.sharing).toBe(true);
    expect(await a.next()).toMatchObject({ type: 'peer-joined', peer: { name: 'Duda' } });

    // peer-left ao fechar
    b.close();
    expect(await a.next()).toEqual({ type: 'peer-left', id: joinedB.selfId });

    a.close();
    d.close();
  });

  it('signal para um destino que não está na sala é ignorado em silêncio', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    const outsider = await TestClient.connect(running, await getToken(running)); // sem join
    await a.join('Ana');
    a.send({
      type: 'signal',
      to: '3f2b8c1e-5a47-4d6b-9c1a-0e7d2f4b6a10',
      data: { gen: 0, reset: true },
    });
    await a.expectSilence();
    await outsider.expectSilence();
    a.close();
    outsider.close();
  });

  it('sala cheia → ROOM_FULL e conexão continua aberta', async () => {
    const clients = await Promise.all(
      [0, 1, 2, 3].map(async () => TestClient.connect(running, await getToken(running))),
    );
    const [c1, c2, c3, c4] = clients;
    if (!c1 || !c2 || !c3 || !c4) throw new Error('conexão falhou');
    await c1.join('U1');
    await c2.join('U2');
    await c3.join('U3');

    c4.send({ type: 'join', name: 'U4' });
    const error = await c4.next();
    expect(error).toMatchObject({ type: 'error', code: 'ROOM_FULL' });
    // quando alguém sai, a vaga é liberada e o mesmo cliente consegue entrar
    c1.send({ type: 'leave' });
    await c2.next(); // peer-left (U1)
    await c3.next();
    expect((await c4.join('U4')).type).toBe('joined');
    clients.forEach((c) => c.close());
  });

  it('nome duplicado de outro login → NAME_TAKEN', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    const b = await TestClient.connect(running, await getToken(running));
    await a.join('Ana');
    b.send({ type: 'join', name: 'ana' });
    expect(await b.next()).toMatchObject({ type: 'error', code: 'NAME_TAKEN' });
    a.close();
    b.close();
  });

  it('join duplicado na mesma conexão → ALREADY_JOINED', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    await a.join('Ana');
    a.send({ type: 'join', name: 'Ana' });
    expect(await a.next()).toMatchObject({ type: 'error', code: 'ALREADY_JOINED' });
    a.close();
  });

  it('mesmo login reentrando com o mesmo nome derruba a conexão antiga', async () => {
    const token = await getToken(running);
    const observer = await TestClient.connect(running, await getToken(running));
    const first = await TestClient.connect(running, token);
    await observer.join('Obs');
    const joinedFirst = await first.join('Ana');
    await observer.next(); // peer-joined (Ana antiga)

    const second = await TestClient.connect(running, token);
    const joinedSecond = await second.join('Ana');
    expect((await first.closed).code).toBe(4001);

    expect(await observer.next()).toEqual({ type: 'peer-left', id: joinedFirst.selfId });
    expect(await observer.next()).toMatchObject({
      type: 'peer-joined',
      peer: { id: joinedSecond.selfId, name: 'Ana' },
    });
    await observer.expectSilence(); // sem peer-left duplicado
    observer.close();
    second.close();
  });

  it('signal/sharing antes de entrar na sala → INVALID', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    a.send({ type: 'sharing', active: true });
    expect(await a.next()).toMatchObject({ type: 'error', code: 'INVALID' });
    a.close();
  });

  it('leave sai da sala sem fechar a conexão e permite novo join', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    const b = await TestClient.connect(running, await getToken(running));
    await a.join('Ana');
    const joinedB = await b.join('Bia');
    await a.next(); // peer-joined
    b.send({ type: 'leave' });
    expect((await a.next()).type).toBe('peer-left');
    expect(joinedB.selfId).toBeTruthy();
    expect((await b.join('Bia')).type).toBe('joined');
    a.close();
    b.close();
  });

  it('só uma pessoa compartilha por vez: o segundo recebe SHARE_BUSY e ninguém é avisado', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    const b = await TestClient.connect(running, await getToken(running));
    const joinedA = await a.join('Ana');
    await b.join('Bia');
    await a.next(); // peer-joined (Bia)

    a.send({ type: 'sharing', active: true });
    expect(await b.next()).toEqual({ type: 'peer-sharing', id: joinedA.selfId, active: true });

    b.send({ type: 'sharing', active: true });
    expect(await b.next()).toMatchObject({ type: 'error', code: 'SHARE_BUSY' });
    await a.expectSilence(); // Ana não recebe peer-sharing da Bia

    // quando a Ana para, a vez fica livre
    a.send({ type: 'sharing', active: false });
    expect(await b.next()).toEqual({ type: 'peer-sharing', id: joinedA.selfId, active: false });
    b.send({ type: 'sharing', active: true });
    expect((await a.next()).type).toBe('peer-sharing');
    a.close();
    b.close();
  });

  it('quem já está compartilhando pode repetir sharing:true sem erro', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    await a.join('Ana');
    a.send({ type: 'sharing', active: true });
    a.send({ type: 'sharing', active: true });
    await a.expectSilence();
    a.close();
  });

  it('quem sai compartilhando libera a vez para os outros', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    const b = await TestClient.connect(running, await getToken(running));
    await a.join('Ana');
    await b.join('Bia');
    await a.next(); // peer-joined
    a.send({ type: 'sharing', active: true });
    await b.next(); // peer-sharing
    a.close();
    await b.next(); // peer-left

    b.send({ type: 'sharing', active: true });
    await b.expectSilence(); // aceito, sem erro
    expect(running.app.signaling.room.sharer()?.name).toBe('Bia');
    b.close();
  });

  it('reentrar com sharing:true enquanto outra pessoa assumiu a vez → entra sem compartilhar e recebe SHARE_BUSY', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    const b = await TestClient.connect(running, await getToken(running));
    await a.join('Ana');
    await b.join('Bia');
    await a.next(); // peer-joined
    b.send({ type: 'sharing', active: true });
    await a.next(); // peer-sharing (Bia)

    const returning = await TestClient.connect(running, await getToken(running));
    const joined = await returning.join('Caio', { sharing: true });
    expect(joined.peers.find((p) => p.name === 'Bia')?.sharing).toBe(true);
    expect(await returning.next()).toMatchObject({ type: 'error', code: 'SHARE_BUSY' });
    expect(running.app.signaling.room.sharer()?.name).toBe('Bia');
    a.close();
    b.close();
    returning.close();
  });

  it('o mesmo login reentrando com sharing:true mantém a vez (substitui a conexão antiga)', async () => {
    const token = await getToken(running);
    const first = await TestClient.connect(running, token);
    await first.join('Ana');
    first.send({ type: 'sharing', active: true });
    await first.expectSilence();

    const second = await TestClient.connect(running, token);
    await second.join('Ana', { sharing: true });
    await second.expectSilence(); // sem SHARE_BUSY
    expect(running.app.signaling.room.sharer()?.name).toBe('Ana');
    second.close();
  });

  it('ping → pong', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    a.send({ type: 'ping' });
    expect(await a.next()).toEqual({ type: 'pong' });
    a.close();
  });

  it('mensagem inválida fecha a conexão com 1008', async () => {
    for (const bad of [
      '{nope',
      JSON.stringify({ type: 'hack' }),
      JSON.stringify({ type: 'join', room: 'outra', name: 'Ana' }), // não existe mais escolher sala
      JSON.stringify({ type: 'join', name: '   ' }),
    ]) {
      const a = await TestClient.connect(running, await getToken(running));
      a.send(bad);
      expect((await a.closed).code).toBe(1008);
    }
  });

  it('mensagem binária fecha a conexão com 1008', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    a.socket.send(Buffer.from([1, 2, 3]));
    expect((await a.closed).code).toBe(1008);
  });

  it('mensagem acima de 64 KB fecha a conexão (1009)', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    a.send(JSON.stringify({ type: 'join', name: 'a'.repeat(70 * 1024) }));
    expect((await a.closed).code).toBe(1009);
  });
});

describe('servidor (limites e heartbeat)', () => {
  it('excesso de mensagens por segundo → RATE_LIMITED e fecha', async () => {
    const running = await startApp({ WS_MSG_RATE_PER_SEC: '5' });
    try {
      const a = await TestClient.connect(running, await getToken(running));
      for (let i = 0; i < 10; i++) a.send({ type: 'ping' });
      expect((await a.closed).code).toBe(1008);
    } finally {
      await running.app.close();
    }
  });

  it('encerra conexões sem ping dentro do timeout e mantém as que enviam ping', async () => {
    const running = await startApp({}, { heartbeatIntervalMs: 20, heartbeatTimeoutMs: 150 });
    try {
      const idle = await TestClient.connect(running, await getToken(running));
      const alive = await TestClient.connect(running, await getToken(running));
      const keepAlive = setInterval(() => alive.send({ type: 'ping' }), 40);

      expect((await idle.closed).code).toBe(1006);
      expect(alive.socket.readyState).toBe(WebSocket.OPEN);
      clearInterval(keepAlive);
      alive.close();
    } finally {
      await running.app.close();
    }
  });

  it('libera o participante da sala quando a conexão cai', async () => {
    const running = await startApp();
    try {
      const a = await TestClient.connect(running, await getToken(running));
      await a.join('Ana');
      expect(running.app.signaling.room.size).toBe(1);
      a.close();
      await a.closed;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(running.app.signaling.room.size).toBe(0);
    } finally {
      await running.app.close();
    }
  });
});
