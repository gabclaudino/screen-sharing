import {
  parseClientMessage,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
} from '@screenshare/shared';
import type { RawData, WebSocket } from 'ws';
import type { Config } from './config';
import type { Logger } from './logger';
import { resolveDisplayName } from './names';
import { Room, toPeerInfo } from './rooms';
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
}

// No máximo 5 reações por segundo por pessoa; o que passar disso é ignorado.
const REACTIONS_PER_SEC = 5;

const WS_CLOSE_POLICY = 1008;
const WS_CLOSE_REPLACED = 4001;

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

  const sendError = (conn: Connection, code: ErrorCode, message: string): void =>
    send(conn.ws, { type: 'error', code, message });

  const broadcast = (exceptPeerId: string, message: ServerMessage): void => {
    for (const peer of room.all()) {
      if (peer.id === exceptPeerId) continue;
      const target = byPeerId.get(peer.id);
      if (target) send(target.ws, message);
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
    logger.info('leave', { peer: peer.id });
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
    send(conn.ws, {
      type: 'joined',
      selfId: peer.id,
      selfName: peer.name,
      reactions: [...config.reactionEmojis],
      peers: others.map(toPeerInfo),
    });
    broadcast(peer.id, { type: 'peer-joined', peer: toPeerInfo(peer) });
    // Avisa o cliente para parar a captura que ele ainda tem ativa.
    if (shareBusy) sendError(conn, 'SHARE_BUSY', 'Outra pessoa já está compartilhando');
    logger.info('join', { peer: peer.id });
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
    for (const conn of connections) conn.ws.close(1001, 'server shutting down');
  };

  /** Antes do upgrade: há espaço para mais uma conexão deste login e do servidor? */
  const canAccept = (sid: string): boolean => {
    if (connections.size >= maxConnections) return false;
    let count = 0;
    for (const conn of connections) if (conn.sid === sid) count += 1;
    return count < maxPerSession;
  };

  return { handleConnection, close, room, canAccept };
}
