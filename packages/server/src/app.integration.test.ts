import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
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

  it('reaction: todos os outros recebem com o `from` do servidor; quem enviou não', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    const b = await TestClient.connect(running, await getToken(running));
    const c = await TestClient.connect(running, await getToken(running));
    const joinedA = await a.join('Ana');
    await b.join('Bia');
    await a.next(); // peer-joined (Bia)
    await c.join('Caio');
    await a.next(); // peer-joined (Caio)
    await b.next();

    a.send({ type: 'reaction', emoji: '🔥' });
    expect(await b.next()).toEqual({ type: 'reaction', from: joinedA.selfId, emoji: '🔥' });
    expect(await c.next()).toEqual({ type: 'reaction', from: joinedA.selfId, emoji: '🔥' });
    await a.expectSilence();
    a.close();
    b.close();
    c.close();
  });

  it('reaction antes do join → INVALID; texto no lugar do emoji → conexão fechada (1008)', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    a.send({ type: 'reaction', emoji: '🔥' });
    expect(await a.next()).toMatchObject({ type: 'error', code: 'INVALID' });
    a.close();

    const b = await TestClient.connect(running, await getToken(running));
    await b.join('Bia');
    b.send({ type: 'reaction', emoji: 'oi' });
    expect((await b.closed).code).toBe(1008);
  });

  it('o joined traz a lista de reações padrão; emoji válido mas fora da lista é ignorado', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    const b = await TestClient.connect(running, await getToken(running));
    const joinedA = await a.join('Ana');
    expect(joinedA.reactions).toHaveLength(6);
    await b.join('Bia');
    await a.next(); // peer-joined

    a.send({ type: 'reaction', emoji: '🍕' }); // emoji de verdade, mas não está na lista
    await b.expectSilence();
    a.send({ type: 'ping' });
    expect(await a.next()).toEqual({ type: 'pong' }); // e a conexão segue de pé
    a.close();
    b.close();
  });

  it('foto de perfil: vai no join, é entregue a quem entra e a troca/remoção avisa os outros', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    const b = await TestClient.connect(running, await getToken(running));
    const joinedA = await a.join('Ana', { avatar: 'guri-3' });
    expect(joinedA.peers).toEqual([]);

    const joinedB = await b.join('Bia');
    expect(joinedB.peers).toEqual([
      { id: joinedA.selfId, name: 'Ana', sharing: false, avatar: 'guri-3' },
    ]);
    // Bia entrou sem foto: o campo nem aparece.
    expect(await a.next()).toEqual({
      type: 'peer-joined',
      peer: { id: joinedB.selfId, name: 'Bia', sharing: false },
    });

    b.send({ type: 'avatar', avatar: 'guri-7' });
    expect(await a.next()).toEqual({ type: 'peer-avatar', id: joinedB.selfId, avatar: 'guri-7' });
    await b.expectSilence(); // quem trocou não recebe o próprio aviso

    b.send({ type: 'avatar', avatar: null });
    expect(await a.next()).toEqual({ type: 'peer-avatar', id: joinedB.selfId, avatar: null });

    // quem entra depois vê a foto atual de cada um
    const c = await TestClient.connect(running, await getToken(running));
    const joinedC = await c.join('Caio');
    expect(joinedC.peers.find((p) => p.name === 'Ana')?.avatar).toBe('guri-3');
    expect(joinedC.peers.find((p) => p.name === 'Bia')).not.toHaveProperty('avatar');
    a.close();
    b.close();
    c.close();
  });

  it('foto de perfil: antes do join → INVALID; id inválido (URL, texto) → conexão fechada (1008)', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    a.send({ type: 'avatar', avatar: 'guri-1' });
    expect(await a.next()).toMatchObject({ type: 'error', code: 'INVALID' });
    a.close();

    for (const avatar of ['https://evil.example/x.png', '../../etc/passwd', 'a b']) {
      const b = await TestClient.connect(running, await getToken(running));
      await b.join('Bia');
      b.send({ type: 'avatar', avatar });
      expect((await b.closed).code).toBe(1008);
    }
    const c = await TestClient.connect(running, await getToken(running));
    c.send({ type: 'join', name: 'Caio', avatar: '<script>' });
    expect((await c.closed).code).toBe(1008);
  });

  it('a rajada de sinalização ao entrar (dezenas de candidates por peer) não derruba a conexão', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    const b = await TestClient.connect(running, await getToken(running));
    await a.join('Ana');
    const joinedB = await b.join('Bia');
    await a.next(); // peer-joined

    // 150 mensagens de uma vez: o que 5 peers com ~30 candidates cada mandam ao entrar.
    const candidate = { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0' };
    for (let i = 0; i < 150; i += 1) {
      a.send({ type: 'signal', to: joinedB.selfId, data: { gen: 0, candidate } });
    }
    for (let i = 0; i < 150; i += 1) expect((await b.next()).type).toBe('signal');

    a.send({ type: 'ping' });
    expect(await a.next()).toEqual({ type: 'pong' }); // Ana segue conectada
    a.close();
    b.close();
  });

  it('reaction em excesso é descartada em silêncio, sem derrubar a conexão', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    const b = await TestClient.connect(running, await getToken(running));
    await a.join('Ana');
    await b.join('Bia');
    await a.next(); // peer-joined

    for (let i = 0; i < 8; i += 1) a.send({ type: 'reaction', emoji: '👏' });
    let received = 0;
    for (let i = 0; i < 5; i += 1) {
      expect((await b.next()).type).toBe('reaction');
      received += 1;
    }
    await b.expectSilence(); // as 3 últimas foram ignoradas
    expect(received).toBe(5);

    a.send({ type: 'ping' });
    expect(await a.next()).toEqual({ type: 'pong' }); // Ana continua conectada
    a.close();
    b.close();
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

describe('reações configuradas (REACTION_EMOJIS)', () => {
  it('o joined traz a lista do dono, que vale também para o envio', async () => {
    const running = await startApp({ REACTION_EMOJIS: '🐸 🍕' });
    const a = await TestClient.connect(running, await getToken(running));
    const b = await TestClient.connect(running, await getToken(running));
    const joinedA = await a.join('Ana');
    expect(joinedA.reactions).toEqual(['🐸', '🍕']);
    await b.join('Bia');
    await a.next(); // peer-joined

    a.send({ type: 'reaction', emoji: '🍕' });
    expect(await b.next()).toEqual({ type: 'reaction', from: joinedA.selfId, emoji: '🍕' });
    a.send({ type: 'reaction', emoji: '🔥' }); // estava na lista padrão, mas não na do dono
    await b.expectSilence();
    a.close();
    b.close();
    await running.app.close();
  });
});

describe('desligar e religar o servidor', () => {
  it('ao desligar, todos os conectados recebem o código 4002 (voltam ao login)', async () => {
    const running = await startApp();
    const a = await TestClient.connect(running, await getToken(running));
    const b = await TestClient.connect(running, await getToken(running));
    await a.join('Ana');
    await b.join('Bia');

    const closing = running.app.close();
    expect((await a.closed).code).toBe(4002);
    expect((await b.closed).code).toBe(4002);
    await closing;
  });

  it('o login de antes do reinício deixa de valer: WS, /api/ice e /api/session dão 401', async () => {
    const before = await startApp();
    const oldToken = await getToken(before);
    const authHeader = { Authorization: `Bearer ${oldToken}` };
    expect((await fetch(`${before.http}/api/session`, { headers: authHeader })).status).toBe(200);
    await before.app.close();

    // Mesma configuração (mesmo SESSION_SECRET), nova execução do servidor.
    const after = await startApp();
    expect((await fetch(`${after.http}/api/session`, { headers: authHeader })).status).toBe(401);
    expect((await fetch(`${after.http}/api/ice`, { headers: authHeader })).status).toBe(401);
    expect(
      await upgradeStatus(`${after.ws}?token=${encodeURIComponent(oldToken)}`, { Origin: ORIGIN }),
    ).toBe(401);

    // Entrando de novo com a senha, tudo volta a funcionar.
    const newToken = await getToken(after);
    expect(
      (
        await fetch(`${after.http}/api/session`, {
          headers: { Authorization: `Bearer ${newToken}` },
        })
      ).status,
    ).toBe(200);
    const client = await TestClient.connect(after, newToken);
    await client.join('Ana');
    client.close();
    await after.app.close();
  });

  it('/api/session: sem token ou com token inválido → 401; só aceita GET', async () => {
    const running = await startApp();
    expect((await fetch(`${running.http}/api/session`)).status).toBe(401);
    const bad = { Authorization: 'Bearer lixo' };
    expect((await fetch(`${running.http}/api/session`, { headers: bad })).status).toBe(401);
    const post = await fetch(`${running.http}/api/session`, { method: 'POST' });
    expect(post.status).toBe(405);
    await running.app.close();
  });
});

describe('apelidos (NAME_ALIASES)', () => {
  const ALIASES = JSON.stringify({ stan: 'Apelido X', stangod: 'Apelido X' });

  /** Entra com `typed`, devolve o nome registrado pelo servidor e sai (liberando a vaga). */
  async function joinAndLeave(running: Running, typed: string): Promise<string | undefined> {
    const client = await TestClient.connect(running, await getToken(running));
    const joined = await client.join(typed);
    client.close();
    await client.closed;
    await new Promise((resolve) => setTimeout(resolve, 30));
    return joined.selfName;
  }

  it('stan e stangod, em qualquer grafia (maiúsculas, espaços, separadores), viram o apelido', async () => {
    const running = await startApp({ NAME_ALIASES: ALIASES });
    try {
      for (const typed of [
        'stan',
        'Stan',
        'STAN',
        'stangod',
        'StanGod',
        'STANGOD',
        'Stan God',
        'stan_god',
        ' stan ',
      ]) {
        expect(await joinAndLeave(running, typed), typed).toBe('Apelido X');
      }
    } finally {
      await running.app.close();
    }
  });

  it('todos veem o apelido: quem já estava, quem entra depois e a própria pessoa', async () => {
    const running = await startApp({ NAME_ALIASES: ALIASES });
    try {
      const observer = await TestClient.connect(running, await getToken(running));
      await observer.join('Ana');
      const stan = await TestClient.connect(running, await getToken(running));
      const joined = await stan.join('StanGod');

      expect(joined.selfName).toBe('Apelido X'); // a própria pessoa
      expect(joined.peers.map((p) => p.name)).toEqual(['Ana']);
      expect(await observer.next()).toMatchObject({
        type: 'peer-joined',
        peer: { id: joined.selfId, name: 'Apelido X' }, // quem já estava
      });

      const late = await TestClient.connect(running, await getToken(running));
      const lateJoined = await late.join('Caio');
      expect(lateJoined.peers.map((p) => p.name).sort()).toEqual(['Ana', 'Apelido X']); // quem entra depois
      observer.close();
      stan.close();
      late.close();
    } finally {
      await running.app.close();
    }
  });

  it('os dois nomes viram o mesmo apelido, então o segundo recebe NAME_TAKEN', async () => {
    const running = await startApp({ NAME_ALIASES: ALIASES });
    try {
      const first = await TestClient.connect(running, await getToken(running));
      const second = await TestClient.connect(running, await getToken(running));
      await first.join('stan');
      second.send({ type: 'join', name: 'stangod' });
      expect(await second.next()).toMatchObject({ type: 'error', code: 'NAME_TAKEN' });
      first.close();
      second.close();
    } finally {
      await running.app.close();
    }
  });

  it('nomes parecidos não são alterados, e sem a variável nada muda', async () => {
    const withAliases = await startApp({ NAME_ALIASES: ALIASES });
    try {
      expect(await joinAndLeave(withAliases, 'stanley')).toBe('stanley');
      expect(await joinAndLeave(withAliases, 'Ana')).toBe('Ana');
    } finally {
      await withAliases.app.close();
    }
    const plain = await startApp();
    try {
      expect(await joinAndLeave(plain, 'stan')).toBe('stan');
    } finally {
      await plain.app.close();
    }
  });

  it('reconexão: o mesmo login entrando de novo com o apelido substitui a conexão antiga', async () => {
    const running = await startApp({ NAME_ALIASES: ALIASES });
    try {
      const token = await getToken(running);
      const first = await TestClient.connect(running, token);
      await first.join('stan');
      const second = await TestClient.connect(running, token);
      const joined = await second.join('stan');
      expect(joined.selfName).toBe('Apelido X');
      expect((await first.closed).code).toBe(4001);
      second.close();
    } finally {
      await running.app.close();
    }
  });
});

describe('endurecimento', () => {
  it('limita as conexões WS por login (4ª → 429) e libera quando uma fecha', async () => {
    const running = await startApp();
    try {
      const token = await getToken(running);
      const clients = await Promise.all([1, 2, 3].map(() => TestClient.connect(running, token)));
      const url = `${running.ws}?token=${token}`;
      expect(await upgradeStatus(url, { Origin: ORIGIN })).toBe(429);

      // outro login não é afetado
      const other = await TestClient.connect(running, await getToken(running));
      other.close();

      clients[0]?.close();
      await clients[0]?.closed;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const again = await TestClient.connect(running, token);
      again.close();
      clients.forEach((c) => c.close());
    } finally {
      await running.app.close();
    }
  });

  it('limita o total de conexões WS do servidor → 429', async () => {
    const running = await startApp({}, { maxConnections: 2 });
    try {
      const a = await TestClient.connect(running, await getToken(running));
      const b = await TestClient.connect(running, await getToken(running));
      const url = `${running.ws}?token=${await getToken(running)}`;
      expect(await upgradeStatus(url, { Origin: ORIGIN })).toBe(429);
      a.close();
      b.close();
    } finally {
      await running.app.close();
    }
  });

  it('fecha a conexão que não faz join a tempo, sem afetar quem entrou', async () => {
    const running = await startApp({}, { joinTimeoutMs: 100 });
    try {
      const idle = await TestClient.connect(running, await getToken(running));
      const joined = await TestClient.connect(running, await getToken(running));
      await joined.join('Ana');

      expect((await idle.closed).code).toBe(1008);
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(joined.socket.readyState).toBe(WebSocket.OPEN);
      joined.close();
    } finally {
      await running.app.close();
    }
  });

  it('um alvo de upgrade malformado → 400 e o servidor continua de pé', async () => {
    const running = await startApp();
    try {
      const response = await new Promise<string>((resolve, reject) => {
        const socket = connect(running.port, '127.0.0.1');
        let data = '';
        socket.on('data', (chunk) => (data += chunk.toString()));
        socket.on('close', () => resolve(data));
        socket.on('error', reject);
        socket.write(
          'GET //[ HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n' +
            'Sec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n',
        );
      });
      expect(response).toMatch(/^HTTP\/1\.1 400/);
      expect((await fetch(`${running.http}/`)).status).toBe(200); // ainda atende
    } finally {
      await running.app.close();
    }
  });

  it('configura os timeouts HTTP contra clientes lentos', async () => {
    const running = await startApp();
    try {
      expect(running.app.server.requestTimeout).toBe(30_000);
      expect(running.app.server.keepAliveTimeout).toBe(95_000);
      // headersTimeout precisa ficar acima do keepAliveTimeout
      expect(running.app.server.headersTimeout).toBeGreaterThan(95_000);
    } finally {
      await running.app.close();
    }
  });

  it('todos os tipos de resposta levam os cabeçalhos de segurança', async () => {
    const running = await startApp();
    try {
      for (const path of ['/', '/api/nada', '/assets/app-abc123.js', '/nao-existe.js']) {
        const res = await fetch(`${running.http}${path}`);
        expect(res.headers.get('cross-origin-opener-policy'), path).toBe('same-origin');
        expect(res.headers.get('cross-origin-resource-policy'), path).toBe('same-origin');
        expect(res.headers.get('x-frame-options'), path).toBe('DENY');
        expect(res.headers.get('content-security-policy'), path).toContain("object-src 'none'");
      }
    } finally {
      await running.app.close();
    }
  });
});

describe('GET /api/ice', () => {
  const TURN = {
    urls: ['turn:turn.example.com:3478?transport=udp'],
    username: 'u-efemero',
    credential: 'c-efemero',
  };
  const cloudflare = {
    ICE_PROVIDER: 'cloudflare',
    CLOUDFLARE_TURN_KEY_ID: 'chave-id',
    CLOUDFLARE_TURN_API_TOKEN: 'TOKEN-SECRETO-DA-API',
  };
  const get = (running: Running, headers: Record<string, string> = {}) =>
    fetch(`${running.http}/api/ice`, { headers });

  it('exige o token de sessão no header Authorization', async () => {
    const running = await startApp();
    try {
      const token = await getToken(running);
      expect((await get(running)).status).toBe(401);
      expect((await get(running, { Authorization: 'Bearer lixo' })).status).toBe(401);
      expect((await get(running, { Authorization: token })).status).toBe(401); // sem "Bearer "
      // o token na query string não vale (iria parar em logs de proxy)
      expect((await fetch(`${running.http}/api/ice?token=${token}`)).status).toBe(401);
      const expired = createToken(SECRET, 'sid', 60, Date.now() - 3600_000).token;
      expect((await get(running, { Authorization: `Bearer ${expired}` })).status).toBe(401);
    } finally {
      await running.app.close();
    }
  });

  it('sem provedor (ICE_PROVIDER=none) devolve só STUN', async () => {
    const running = await startApp();
    try {
      const token = await getToken(running);
      const res = await get(running, { Authorization: `Bearer ${token}` });
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const body = (await res.json()) as { iceServers: { urls: string[] }[] };
      expect(body.iceServers).toHaveLength(1);
      expect(body.iceServers[0]?.urls[0]).toMatch(/^stun:/);
    } finally {
      await running.app.close();
    }
  });

  it('com provedor devolve STUN + TURN, usa cache e nunca expõe a chave da API', async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      calls.push(String(input));
      return new Response(JSON.stringify({ iceServers: [TURN] }), { status: 201 });
    };
    const running = await startApp(cloudflare, { fetchImpl });
    try {
      const token = await getToken(running);
      const auth = { Authorization: `Bearer ${token}` };
      const first = await (await get(running, auth)).text();
      const second = await (await get(running, auth)).text();

      const body = JSON.parse(first) as { iceServers: unknown[] };
      expect(body.iceServers).toHaveLength(2);
      expect(body.iceServers[1]).toEqual(TURN);
      expect(second).toBe(first);
      expect(calls).toHaveLength(1); // a segunda veio do cache
      expect(calls[0]).toContain('/v1/turn/keys/chave-id/credentials/generate-ice-servers');
      expect(first).not.toContain('TOKEN-SECRETO-DA-API');
    } finally {
      await running.app.close();
    }
  });

  it('se o provedor falha, responde 200 só com STUN (nunca 5xx)', async () => {
    const fetchImpl: typeof fetch = async () => new Response('erro', { status: 500 });
    const running = await startApp(cloudflare, { fetchImpl });
    try {
      const token = await getToken(running);
      const res = await get(running, { Authorization: `Bearer ${token}` });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { iceServers: { urls: string[] }[] };
      expect(body.iceServers).toHaveLength(1);
      expect(body.iceServers[0]?.urls[0]).toMatch(/^stun:/);
    } finally {
      await running.app.close();
    }
  });

  it('métodos diferentes de GET → 405', async () => {
    const running = await startApp();
    try {
      const res = await fetch(`${running.http}/api/ice`, { method: 'POST' });
      expect(res.status).toBe(405);
      expect(res.headers.get('allow')).toBe('GET');
    } finally {
      await running.app.close();
    }
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

describe('roleta (WebSocket)', () => {
  let running: Running;

  beforeEach(async () => {
    running = await startApp({ NAME_ALIASES: '{"fulano":"Apelido"}' }, { rouletteSpinMs: 50 });
  });
  afterEach(async () => {
    await running.app.close();
  });

  async function rouletteState(client: TestClient) {
    const message = await client.next();
    if (message.type !== 'roulette') throw new Error(`esperava roulette, veio ${message.type}`);
    return message.state;
  }

  it('todos veem o controle, os nomes e o sorteio; quem não controla é ignorado', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    const b = await TestClient.connect(running, await getToken(running));
    const joinedA = await a.join('Ana');
    expect(joinedA.roulette).toMatchObject({ ownerId: null, entries: [] });
    await b.join('Bia');
    await a.next(); // peer-joined

    const roulette = (command: object) => ({ type: 'roulette', command });
    a.send(roulette({ action: 'claim' }));
    expect((await rouletteState(a)).ownerId).toBe(joinedA.selfId);
    expect((await rouletteState(b)).ownerId).toBe(joinedA.selfId);

    b.send(roulette({ action: 'claim' }));
    b.send(roulette({ action: 'add', name: 'Intruso' }));
    await a.expectSilence();

    // Os apelidos configurados também valem na roleta.
    a.send(roulette({ action: 'add', name: 'fulano' }));
    expect((await rouletteState(a)).entries).toEqual(['Apelido']);
    expect((await rouletteState(b)).entries).toEqual(['Apelido']);

    a.send(roulette({ action: 'spin' }));
    expect((await rouletteState(b)).spin).toMatchObject({ seq: 1, index: 0 });
    expect(await rouletteState(b)).toMatchObject({
      entries: [],
      teams: [['Apelido'], []],
      spin: null,
      last: { name: 'Apelido', team: 0 },
    });

    // O dono sai: a roleta fica livre, com o resultado preservado.
    a.close();
    expect(await b.next()).toMatchObject({ type: 'peer-left' });
    expect(await rouletteState(b)).toMatchObject({ ownerId: null, teams: [['Apelido'], []] });

    // Quem chega depois recebe o estado atual.
    const c = await TestClient.connect(running, await getToken(running));
    expect((await c.join('Caio')).roulette?.teams).toEqual([['Apelido'], []]);
    b.close();
    c.close();
  });

  it('reconexão do mesmo login mantém o controle; sala vazia zera a roleta', async () => {
    const token = await getToken(running);
    const observer = await TestClient.connect(running, await getToken(running));
    await observer.join('Bia');
    const first = await TestClient.connect(running, token);
    await first.join('Ana');
    await observer.next(); // peer-joined
    first.send({ type: 'roulette', command: { action: 'claim' } });
    await rouletteState(observer);

    const second = await TestClient.connect(running, token);
    const joined = await second.join('Ana');
    expect(joined.roulette?.ownerId).toBe(joined.selfId);
    await observer.next(); // peer-left
    await observer.next(); // peer-joined
    expect((await rouletteState(observer)).ownerId).toBe(joined.selfId);

    second.close();
    observer.close();
    await Promise.all([second.closed, observer.closed]);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const later = await TestClient.connect(running, await getToken(running));
    expect((await later.join('Duda')).roulette).toMatchObject({ ownerId: null, entries: [] });
    later.close();
  });

  it('roulette antes do join → INVALID; comando desconhecido fecha a conexão (1008)', async () => {
    const a = await TestClient.connect(running, await getToken(running));
    a.send({ type: 'roulette', command: { action: 'claim' } });
    expect(await a.next()).toMatchObject({ type: 'error', code: 'INVALID' });
    await a.join('Ana');
    a.send({ type: 'roulette', command: { action: 'escolher', name: 'Ana' } });
    expect((await a.closed).code).toBe(1008);
  });
});
