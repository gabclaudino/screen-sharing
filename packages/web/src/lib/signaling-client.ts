import {
  parseServerMessage,
  type ClientMessage,
  type ErrorCode,
  type PeerInfo,
  type ServerMessage,
  type SignalData,
} from '@screenshare/shared';
import type { Session } from './auth';

// Subconjunto de WebSocket que o cliente usa; permite injetar um falso nos testes.
export interface WebSocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((event: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type SignalingStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed';

/** Por que o cliente parou de vez (sem tentar reconectar). */
export type CloseReason =
  | 'disconnect' // chamada explícita a disconnect()
  | 'auth-expired' // sem token válido: voltar ao login
  | 'rejected' // servidor recusou o join (sala cheia, nome em uso, rate limit)
  | 'replaced' // outra conexão do mesmo login assumiu o lugar
  | 'policy'; // servidor fechou com 1008 (mensagem inválida / excesso de mensagens)

export interface SignalingEvents {
  status: SignalingStatus;
  /** Disparado a cada join confirmado, inclusive depois de uma reconexão (novo `selfId`). */
  joined: { selfId: string; peers: PeerInfo[] };
  'peer-joined': PeerInfo;
  'peer-left': string;
  signal: { from: string; data: SignalData };
  'peer-sharing': { id: string; active: boolean };
  /** Erro enviado pelo servidor (ROOM_FULL, NAME_TAKEN, ...). */
  error: { code: ErrorCode; message: string };
  /** A conexão caiu e o cliente vai tentar reconectar sozinho. */
  disconnected: undefined;
  closed: { reason: CloseReason };
}

export interface SignalingClientOptions {
  /** URL do WS sem query, ex.: `wss://share.exemplo.com/ws`. */
  url: string;
  room: string;
  name: string;
  /** Sessão atual; `null` ou perto de expirar → o cliente encerra com `auth-expired`. */
  getSession: () => Session | null;
  /** true se ainda está compartilhando ao reentrar após uma queda (vai no `join`). */
  getSharing?: () => boolean;
  webSocketFactory?: (url: string) => WebSocketLike;
  pingIntervalMs?: number;
  pongTimeoutMs?: number;
  backoffMinMs?: number;
  backoffMaxMs?: number;
  /** Margem de validade do token abaixo da qual preferimos pedir novo login. */
  tokenMarginMs?: number;
  now?: () => number;
}

const WS_OPEN = 1;
const CLOSE_POLICY = 1008;
const CLOSE_REPLACED = 4001;
const REJECTING_ERRORS: ReadonlySet<ErrorCode> = new Set([
  'ROOM_FULL',
  'NAME_TAKEN',
  'RATE_LIMITED',
]);

// Os navegadores tipam handlers com `Event`; o cast só estreita para o subconjunto acima.
const defaultFactory = (url: string): WebSocketLike =>
  new WebSocket(url) as unknown as WebSocketLike;

/** `ws(s)://<host>/ws` para a origem da página (mesma origem do servidor). */
export function buildWsUrl(location: Pick<Location, 'protocol' | 'host'>): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
}

type Handler<K extends keyof SignalingEvents> = (payload: SignalingEvents[K]) => void;

/**
 * Cliente de sinalização: conecta, faz `join`, envia `ping` periódico, detecta conexão morta
 * e reconecta com backoff exponencial. Classe pura (sem React) para ser testável.
 */
export class SignalingClient {
  private readonly opts: Required<Omit<SignalingClientOptions, 'getSharing' | 'webSocketFactory'>> &
    Pick<SignalingClientOptions, 'getSharing' | 'webSocketFactory'>;
  // O tipo de cada Set depende da chave; `listenersFor` faz o cast num único lugar.
  private readonly listeners = new Map<keyof SignalingEvents, Set<unknown>>();

  private socket: WebSocketLike | null = null;
  private currentStatus: SignalingStatus = 'idle';
  private attempt = 0;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private pongTimer: ReturnType<typeof setTimeout> | undefined;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: SignalingClientOptions) {
    this.opts = {
      pingIntervalMs: 25_000,
      pongTimeoutMs: 10_000,
      backoffMinMs: 1_000,
      backoffMaxMs: 15_000,
      tokenMarginMs: 5 * 60_000,
      now: () => Date.now(),
      ...options,
    };
  }

  get status(): SignalingStatus {
    return this.currentStatus;
  }

  on<K extends keyof SignalingEvents>(event: K, handler: Handler<K>): () => void {
    const set = this.listenersFor(event);
    set.add(handler);
    return () => set.delete(handler);
  }

  private listenersFor<K extends keyof SignalingEvents>(event: K): Set<Handler<K>> {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    return set as Set<Handler<K>>;
  }

  connect(): void {
    if (this.currentStatus !== 'idle' && this.currentStatus !== 'closed') return;
    this.attempt = 0;
    this.openSocket('connecting');
  }

  /** Sai da sala (`leave`), fecha o socket e não reconecta. */
  disconnect(): void {
    if (this.currentStatus === 'closed' || this.currentStatus === 'idle') return;
    if (this.socket?.readyState === WS_OPEN) this.sendMessage({ type: 'leave' });
    this.finish('disconnect');
  }

  /** Devolve `false` se não estiver conectado (a mensagem não é enfileirada). */
  sendSignal(to: string, data: SignalData): boolean {
    return this.sendWhenConnected({ type: 'signal', to, data });
  }

  sendSharing(active: boolean): boolean {
    return this.sendWhenConnected({ type: 'sharing', active });
  }

  // -------------------------------------------------------------------------

  private emit<K extends keyof SignalingEvents>(event: K, payload: SignalingEvents[K]): void {
    this.listenersFor(event).forEach((handler) => handler(payload));
  }

  private setStatus(status: SignalingStatus): void {
    if (this.currentStatus === status) return;
    this.currentStatus = status;
    this.emit('status', status);
  }

  private sendMessage(message: ClientMessage): void {
    this.socket?.send(JSON.stringify(message));
  }

  private sendWhenConnected(message: ClientMessage): boolean {
    if (this.currentStatus !== 'connected' || this.socket?.readyState !== WS_OPEN) return false;
    this.sendMessage(message);
    return true;
  }

  private openSocket(status: 'connecting' | 'reconnecting'): void {
    const session = this.opts.getSession();
    if (!session || session.expiresAt - this.opts.now() < this.opts.tokenMarginMs) {
      this.finish('auth-expired');
      return;
    }
    this.setStatus(status);

    const factory = this.opts.webSocketFactory ?? defaultFactory;
    const socket = factory(`${this.opts.url}?token=${encodeURIComponent(session.token)}`);
    this.socket = socket;

    // Eventos de um socket que já foi substituído/descartado são ignorados.
    socket.onopen = () => {
      if (this.socket !== socket) return;
      this.sendMessage({
        type: 'join',
        room: this.opts.room,
        name: this.opts.name,
        ...(this.opts.getSharing?.() ? { sharing: true } : {}),
      });
      this.startPing();
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket || typeof event.data !== 'string') return;
      this.clearPongTimer(); // qualquer mensagem prova que a conexão está viva
      const parsed = parseServerMessage(event.data);
      if (!parsed.ok) {
        console.error('[signaling] mensagem inválida do servidor:', parsed.reason);
        return;
      }
      this.handleServerMessage(parsed.message);
    };
    socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this.handleClose(event.code);
    };
    // O `onclose` sempre vem depois do erro; nada a fazer aqui além de não deixar vazar.
    socket.onerror = () => undefined;
  }

  private handleServerMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'joined':
        this.attempt = 0;
        this.setStatus('connected');
        this.emit('joined', { selfId: message.selfId, peers: message.peers });
        return;
      case 'peer-joined':
        this.emit('peer-joined', message.peer);
        return;
      case 'peer-left':
        this.emit('peer-left', message.id);
        return;
      case 'signal':
        this.emit('signal', { from: message.from, data: message.data });
        return;
      case 'peer-sharing':
        this.emit('peer-sharing', { id: message.id, active: message.active });
        return;
      case 'error':
        this.emit('error', { code: message.code, message: message.message });
        // Recusas de join não se resolvem sozinhas: reconectar só repetiria o erro.
        if (REJECTING_ERRORS.has(message.code)) this.finish('rejected');
        return;
      case 'pong':
        return;
    }
  }

  private handleClose(code: number): void {
    const wasConnected = this.currentStatus === 'connected';
    this.stopTimers();
    this.detachSocket();

    if (code === CLOSE_POLICY) return this.finish('policy');
    if (code === CLOSE_REPLACED) return this.finish('replaced');

    this.setStatus('reconnecting');
    if (wasConnected) this.emit('disconnected', undefined);

    // 1 s → 2 s → 4 s ... limitado a backoffMaxMs.
    const delay = Math.min(this.opts.backoffMaxMs, this.opts.backoffMinMs * 2 ** this.attempt);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.openSocket('reconnecting');
    }, delay);
  }

  private startPing(): void {
    this.stopTimers();
    this.pingTimer = setInterval(() => {
      if (this.socket?.readyState !== WS_OPEN) return;
      this.sendMessage({ type: 'ping' });
      this.clearPongTimer();
      this.pongTimer = setTimeout(() => {
        // Sem resposta: tratamos como queda sem esperar o handshake de close (rede morta).
        this.handleClose(1006);
      }, this.opts.pongTimeoutMs);
    }, this.opts.pingIntervalMs);
  }

  private clearPongTimer(): void {
    clearTimeout(this.pongTimer);
    this.pongTimer = undefined;
  }

  private stopTimers(): void {
    clearInterval(this.pingTimer);
    this.pingTimer = undefined;
    this.clearPongTimer();
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  private detachSocket(): void {
    const socket = this.socket;
    if (!socket) return;
    this.socket = null;
    socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
    try {
      socket.close(1000);
    } catch {
      // socket já fechado
    }
  }

  private finish(reason: CloseReason): void {
    this.stopTimers();
    this.detachSocket();
    this.setStatus('closed');
    this.emit('closed', { reason });
  }
}
