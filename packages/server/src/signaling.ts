import {
  parseClientMessage,
  type ClientMessage,
  type ErrorCode,
  type ServerMessage,
} from '@screenshare/shared';
import type { RawData, WebSocket } from 'ws';
import type { Config } from './config';
import type { Logger } from './logger';
import { RoomManager, toPeerInfo } from './rooms';
import { RateLimiter } from './security';

export interface SignalingOptions {
  config: Pick<Config, 'maxPeersPerRoom' | 'wsMsgRatePerSec'>;
  logger: Logger;
  /** Intervalo da varredura de conexões ociosas. */
  heartbeatIntervalMs: number;
  /** Sem nenhuma mensagem (ping) por este tempo → conexão encerrada. */
  heartbeatTimeoutMs: number;
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
}

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
  const rooms = new RoomManager(config.maxPeersPerRoom);
  const connections = new Set<Connection>();
  const byPeerId = new Map<string, Connection>();

  const sendError = (conn: Connection, code: ErrorCode, message: string): void =>
    send(conn.ws, { type: 'error', code, message });

  const broadcast = (room: string, exceptPeerId: string, message: ServerMessage): void => {
    for (const peer of rooms.peersInRoom(room)) {
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
    const peer = rooms.leave(peerId);
    if (!peer) return;
    broadcast(peer.room, peer.id, { type: 'peer-left', id: peer.id });
    logger.info('leave', { room: peer.room, peer: peer.id });
  };

  const handleJoin = (conn: Connection, msg: Extract<ClientMessage, { type: 'join' }>): void => {
    if (conn.peerId !== undefined) {
      sendError(conn, 'ALREADY_JOINED', 'Você já está em uma sala');
      return;
    }

    const result = rooms.join(msg.room, {
      name: msg.name,
      sid: conn.sid,
      sharing: msg.sharing ?? false,
    });
    if (!result.ok) {
      const text = result.code === 'ROOM_FULL' ? 'Sala cheia' : 'Nome já em uso nesta sala';
      sendError(conn, result.code, text);
      logger.warn('join_rejected', { room: msg.room, code: result.code });
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
      broadcast(peer.room, peer.id, { type: 'peer-left', id: evicted.id });
    }

    conn.peerId = peer.id;
    byPeerId.set(peer.id, conn);
    send(conn.ws, { type: 'joined', selfId: peer.id, peers: others.map(toPeerInfo) });
    broadcast(peer.room, peer.id, { type: 'peer-joined', peer: toPeerInfo(peer) });
    logger.info('join', { room: peer.room, peer: peer.id });
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
      case 'signal':
      case 'sharing': {
        const self = conn.peerId === undefined ? undefined : rooms.get(conn.peerId);
        if (!self) {
          sendError(conn, 'INVALID', 'Entre em uma sala primeiro');
          return;
        }
        if (msg.type === 'sharing') {
          rooms.setSharing(self.id, msg.active);
          broadcast(self.room, self.id, { type: 'peer-sharing', id: self.id, active: msg.active });
          return;
        }
        // Só repassa dentro da mesma sala; destino inexistente (acabou de sair) é ignorado.
        const target = byPeerId.get(msg.to);
        if (!target || !rooms.sameRoom(self.id, msg.to)) return;
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
    };
    connections.add(conn);

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

  return { handleConnection, close, rooms };
}
