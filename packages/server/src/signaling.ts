import {
  parseClientMessage,
  type ClientMessage,
  type ErrorCode,
  type RouletteCommand,
  type ServerMessage,
} from '@screenshare/shared';
import type { RawData, WebSocket } from 'ws';
import type { Config } from './config';
import type { Logger } from './logger';
import { resolveDisplayName } from './names';
import { Room, toPeerInfo } from './rooms';
import { Roulette } from './roulette';
import { RateLimiter } from './security';

export interface SignalingOptions {
  config: Pick<Config, 'maxPeersPerRoom' | 'wsMsgRatePerSec' | 'nameAliases' | 'reactionEmojis'>;
  logger: Logger;
  /** Intervalo da varredura de conexões ociosas. */
  heartbeatIntervalMs: number;
  /** Sem nenhuma mensagem (ping) por este tempo → conexão encerrada. */
  heartbeatTimeoutMs: number;
  /** Máximo de conexões abertas por login (padrão 3: uma aba + reconexões em andamento). */
  maxConnectionsPerSession?: number;
  /** Máximo de conexões abertas no servidor todo (padrão: 5× o limite da sala). */
  maxConnections?: number;
  /** Quanto esperar o `join` depois de abrir a conexão (padrão 15 s). */
  joinTimeoutMs?: number;
  /** Duração do giro da roleta; encurtada nos testes. */
  rouletteSpinMs?: number;
}

export interface ConnectionContext {
  /** Sessão de login (do token) que abriu esta conexão. */
  sid: string;
}

interface Connection {
  ws: WebSocket;
  sid: string;
  peerId: string | undefined;
  lastSeen: number;
  limiter: RateLimiter;
  reactionLimiter: RateLimiter;
  rouletteLimiter: RateLimiter;
}

// No máximo 5 reações por segundo por pessoa; o que passar disso é ignorado.
const REACTIONS_PER_SEC = 5;
// Cada comando da roleta é repassado a todos: folga para digitar nomes, sem virar inundação.
const ROULETTE_COMMANDS_PER_SEC = 20;

// Quantas entradas lembrar (inclusive de quem já saiu) para dar nome aos relatos de conexão.
const REMEMBERED_PEERS = 100;

const WS_CLOSE_POLICY = 1008;
const WS_CLOSE_REPLACED = 4001;
// Servidor desligando: o cliente volta à tela de entrada em vez de ficar tentando reconectar.
// Código próprio de propósito: o 1001 também pode vir de um reinício do Cloudflare/túnel.
const WS_CLOSE_SHUTDOWN = 4002;

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

function send(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

export function createSignaling(options: SignalingOptions) {
  const { config, logger } = options;
  const room = new Room(config.maxPeersPerRoom);
  const maxPerSession = options.maxConnectionsPerSession ?? 3;
  const maxConnections = options.maxConnections ?? config.maxPeersPerRoom * 5;
  const joinTimeoutMs = options.joinTimeoutMs ?? 15_000;
  const connections = new Set<Connection>();
  const byPeerId = new Map<string, Connection>();
  const known = new Map<string, { name: string; sid: string }>();

  const sendError = (conn: Connection, code: ErrorCode, message: string): void =>
    send(conn.ws, { type: 'error', code, message });

  const broadcast = (exceptPeerId: string, message: ServerMessage): void => {
    for (const peer of room.all()) {
      if (peer.id === exceptPeerId) continue;
      const target = byPeerId.get(peer.id);
      if (target) send(target.ws, message);
    }
  };

  const roulette = new Roulette({
    onResolve: () => broadcastRoulette(),
    ...(options.rouletteSpinMs === undefined ? {} : { spinMs: options.rouletteSpinMs }),
  });
  /** Manda o estado da roleta a todos (inclusive quem pediu a mudança). */
  const broadcastRoulette = (exceptPeerId = ''): void =>
    broadcast(exceptPeerId, { type: 'roulette', state: roulette.toState() });

  const handleRoulette = (peerId: string, command: RouletteCommand): boolean => {
    switch (command.action) {
      case 'claim':
        return roulette.claim(peerId);
      case 'release':
        return roulette.release(peerId);
      case 'add':
        // Os apelidos configurados valem aqui como na lista de participantes.
        return roulette.add(peerId, resolveDisplayName(command.name, config.nameAliases));
      case 'remove':
        return roulette.remove(peerId, command.name);
      case 'spin':
        return roulette.start(peerId);
      case 'reset':
        return roulette.reset(peerId, command.clear);
    }
  };

  const leaveRoom = (conn: Connection): void => {
    const peerId = conn.peerId;
    if (peerId === undefined) return;
    conn.peerId = undefined;
    byPeerId.delete(peerId);
    const peer = room.leave(peerId);
    if (!peer) return;
    broadcast(peer.id, { type: 'peer-left', id: peer.id });
    if (room.size === 0) roulette.clear();
    else if (roulette.release(peer.id)) broadcastRoulette();
    logger.info('leave', { peer: peer.id, name: peer.name });
  };

  const handleJoin = (conn: Connection, msg: Extract<ClientMessage, { type: 'join' }>): void => {
    if (conn.peerId !== undefined) {
      sendError(conn, 'ALREADY_JOINED', 'Você já está em uma sala');
      return;
    }

    // Reentrando após queda enquanto ainda compartilha: só vale se outra pessoa não assumiu
    // a vez nesse meio-tempo (o próprio login anterior não conta, ele será substituído).
    const shareBusy = msg.sharing === true && room.sharer(conn.sid) !== undefined;
    const result = room.join({
      // O servidor decide o nome exibido: apelidos configurados valem para todos, inclusive
      // para a própria pessoa (que recebe o nome final em `selfName`).
      name: resolveDisplayName(msg.name, config.nameAliases),
      sid: conn.sid,
      sharing: msg.sharing === true && !shareBusy,
      ...(msg.avatar === undefined ? {} : { avatar: msg.avatar }),
    });
    if (!result.ok) {
      const text = result.code === 'ROOM_FULL' ? 'Sala cheia' : 'Nome já em uso na sala';
      sendError(conn, result.code, text);
      logger.warn('join_rejected', { code: result.code });
      return;
    }

    const { peer, others, evicted } = result;
    if (evicted) {
      // Reconexão do mesmo login: derruba a conexão antiga sem gerar novo peer-left depois.
      const old = byPeerId.get(evicted.id);
      if (old) {
        old.peerId = undefined;
        byPeerId.delete(evicted.id);
        old.ws.close(WS_CLOSE_REPLACED, 'replaced by a newer connection');
      }
      broadcast(peer.id, { type: 'peer-left', id: evicted.id });
    }

    conn.peerId = peer.id;
    byPeerId.set(peer.id, conn);
    known.set(peer.id, { name: peer.name, sid: peer.sid });
    if (known.size > REMEMBERED_PEERS) known.delete(known.keys().next().value as string);
    const handedOver = evicted !== undefined && roulette.handover(evicted.id, peer.id);
    send(conn.ws, {
      type: 'joined',
      selfId: peer.id,
      selfName: peer.name,
      reactions: [...config.reactionEmojis],
      peers: others.map(toPeerInfo),
      roulette: roulette.toState(),
    });
    broadcast(peer.id, { type: 'peer-joined', peer: toPeerInfo(peer) });
    if (handedOver) broadcastRoulette(peer.id);
    // Avisa o cliente para parar a captura que ele ainda tem ativa.
    if (shareBusy) sendError(conn, 'SHARE_BUSY', 'Outra pessoa já está compartilhando');
    logger.info('join', { peer: peer.id, name: peer.name });
  };

  const handleMessage = (conn: Connection, msg: ClientMessage): void => {
    switch (msg.type) {
      case 'ping':
        send(conn.ws, { type: 'pong' });
        return;
      case 'join':
        handleJoin(conn, msg);
        return;
      case 'leave':
        leaveRoom(conn);
        return;
      case 'avatar': {
        const self = conn.peerId === undefined ? undefined : room.get(conn.peerId);
        if (!self) {
          sendError(conn, 'INVALID', 'Entre na sala primeiro');
          return;
        }
        room.setAvatar(self.id, msg.avatar);
        broadcast(self.id, { type: 'peer-avatar', id: self.id, avatar: msg.avatar });
        return;
      }
      case 'reaction': {
        const self = conn.peerId === undefined ? undefined : room.get(conn.peerId);
        if (!self) {
          sendError(conn, 'INVALID', 'Entre na sala primeiro');
          return;
        }
        // Emoji fora da lista configurada (ex.: aba aberta antes de o dono trocar a lista) e excesso
        // de reações são descartados em silêncio: não vale derrubar a conexão por isso.
        if (!config.reactionEmojis.includes(msg.emoji)) return;
        if (!conn.reactionLimiter.hit('reaction')) return;
        broadcast(self.id, { type: 'reaction', from: self.id, emoji: msg.emoji });
        return;
      }
      case 'roulette': {
        const self = conn.peerId === undefined ? undefined : room.get(conn.peerId);
        if (!self) {
          sendError(conn, 'INVALID', 'Entre na sala primeiro');
          return;
        }
        if (!conn.rouletteLimiter.hit('roulette')) return;
        // Pedido que não vale (outra pessoa no controle, durante o giro...) é ignorado.
        if (handleRoulette(self.id, msg.command)) broadcastRoulette();
        return;
      }
      case 'signal':
      case 'sharing': {
        const self = conn.peerId === undefined ? undefined : room.get(conn.peerId);
        if (!self) {
          sendError(conn, 'INVALID', 'Entre na sala primeiro');
          return;
        }
        if (msg.type === 'sharing') {
          // Uma pessoa por vez: o servidor decide, então não há disputa entre clientes.
          if (msg.active && room.sharer(self.sid)) {
            sendError(conn, 'SHARE_BUSY', 'Outra pessoa já está compartilhando');
            logger.info('share_busy', { peer: self.id });
            return;
          }
          room.setSharing(self.id, msg.active);
          broadcast(self.id, { type: 'peer-sharing', id: self.id, active: msg.active });
          return;
        }
        // Só quem já entrou na sala está em byPeerId; destino que acabou de sair é ignorado.
        const target = byPeerId.get(msg.to);
        if (!target) return;
        send(target.ws, { type: 'signal', from: self.id, data: msg.data });
        return;
      }
    }
  };

  const handleConnection = (ws: WebSocket, context: ConnectionContext): void => {
    const conn: Connection = {
      ws,
      sid: context.sid,
      peerId: undefined,
      lastSeen: Date.now(),
      limiter: new RateLimiter(config.wsMsgRatePerSec, 1000),
      reactionLimiter: new RateLimiter(REACTIONS_PER_SEC, 1000),
      rouletteLimiter: new RateLimiter(ROULETTE_COMMANDS_PER_SEC, 1000),
    };
    connections.add(conn);

    // Conexão autenticada que nunca entra na sala só gasta recursos: encerra.
    const joinTimer = setTimeout(() => {
      if (conn.peerId !== undefined) return;
      logger.warn('join_timeout');
      ws.close(WS_CLOSE_POLICY, 'join timeout');
    }, joinTimeoutMs);
    joinTimer.unref();

    ws.on('message', (data, isBinary) => {
      conn.lastSeen = Date.now();
      if (!conn.limiter.hit('msg')) {
        // Sem isto a causa é invisível: a pessoa só vê "Muitas mensagens" e o log mostra join+leave.
        logger.warn('ws_rate_limited', { peer: conn.peerId });
        sendError(conn, 'RATE_LIMITED', 'Muitas mensagens');
        ws.close(WS_CLOSE_POLICY, 'rate limited');
        return;
      }
      if (isBinary) {
        ws.close(WS_CLOSE_POLICY, 'binary messages not supported');
        return;
      }
      const parsed = parseClientMessage(rawToString(data));
      if (!parsed.ok) {
        ws.close(WS_CLOSE_POLICY, 'invalid message');
        return;
      }
      try {
        handleMessage(conn, parsed.message);
      } catch (error) {
        logger.error('handler_error', {
          message: error instanceof Error ? error.message : 'unknown',
        });
        ws.close(1011, 'internal error');
      }
    });

    ws.on('close', () => {
      clearTimeout(joinTimer);
      connections.delete(conn);
      leaveRoom(conn);
    });

    ws.on('error', (error) => {
      logger.warn('ws_error', { message: error.message });
    });
  };

  const heartbeat = setInterval(() => {
    const now = Date.now();
    for (const conn of connections) {
      if (now - conn.lastSeen > options.heartbeatTimeoutMs) {
        logger.info('heartbeat_timeout', { peer: conn.peerId });
        conn.ws.terminate();
      }
    }
  }, options.heartbeatIntervalMs);
  heartbeat.unref();

  const close = (): void => {
    clearInterval(heartbeat);
    roulette.clear();
    for (const conn of connections) conn.ws.close(WS_CLOSE_SHUTDOWN, 'server shutting down');
  };

  /** Antes do upgrade: há espaço para mais uma conexão deste login e do servidor? */
  const canAccept = (sid: string): boolean => {
    if (connections.size >= maxConnections) return false;
    let count = 0;
    for (const conn of connections) if (conn.sid === sid) count += 1;
    return count < maxPerSession;
  };

  /** Nome e login de quem está (ou esteve há pouco) na sala. */
  const identify = (peerId: string) => known.get(peerId);

  return { handleConnection, close, room, canAccept, identify };
}
