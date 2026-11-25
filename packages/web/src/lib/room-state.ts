import type { ErrorCode, PeerInfo, RouletteState } from '@screenshare/shared';
import type { ConnectionInfo, PeerStatus } from './peer-link';
import type { CloseReason, SignalingStatus } from './signaling-client';

/** O que a UI sabe de cada participante remoto. */
export interface PeerView {
  id: string;
  name: string;
  sharing: boolean;
  /** Id da foto de perfil; `null` = sem foto. */
  avatar: string | null;
  status: PeerStatus;
  /** Como a conexão passa (tipos de candidate, protocolo do relay); `null` até saber. */
  connection: ConnectionInfo | null;
  stream: MediaStream | null;
}

export interface RoomState {
  phase: SignalingStatus;
  selfId: string | null;
  /** Nome com que o servidor nos registrou (pode ser um apelido configurado). */
  selfName: string | null;
  /** Emojis dos botões de reação, como o servidor configurou; `null` = lista padrão. */
  reactions: string[] | null;
  /** Roleta da sala; `null` = ainda sem estado (ou servidor sem roleta). */
  roulette: RouletteState | null;
  peers: Record<string, PeerView>;
  /** true depois do primeiro `joined`; distingue "conectando pela 1ª vez" de "reconectando". */
  everJoined: boolean;
  /** Sem os servidores de relay (TURN): só conexões diretas; redes restritivas podem falhar. */
  iceFallback: boolean;
  /** Quantas vezes o servidor recusou um compartilhamento (SHARE_BUSY); a UI reage a cada uma. */
  shareRejections: number;
  /** Último erro enviado pelo servidor (sala cheia, nome em uso...). */
  lastError: ErrorCode | null;
  closed: CloseReason | null;
}

export type RoomAction =
  | { type: 'phase'; phase: SignalingStatus }
  | {
      type: 'joined';
      selfId: string;
      selfName: string | undefined;
      reactions: string[] | undefined;
      peers: PeerInfo[];
      roulette?: RouletteState | undefined;
    }
  | { type: 'roulette'; roulette: RouletteState }
  | { type: 'peer-joined'; peer: PeerInfo }
  | { type: 'peer-left'; id: string }
  | { type: 'peer-sharing'; id: string; active: boolean }
  | { type: 'peer-avatar'; id: string; avatar: string | null }
  | { type: 'peer-status'; id: string; status: PeerStatus }
  | { type: 'peer-connection'; id: string; info: ConnectionInfo }
  | { type: 'peer-stream'; id: string; stream: MediaStream | null }
  | { type: 'error'; code: ErrorCode }
  | { type: 'share-rejected' }
  | { type: 'ice-fallback'; fallback: boolean }
  | { type: 'closed'; reason: CloseReason };

export const createInitialRoomState = (): RoomState => ({
  phase: 'idle',
  selfId: null,
  selfName: null,
  reactions: null,
  roulette: null,
  peers: {},
  everJoined: false,
  iceFallback: false,
  shareRejections: 0,
  lastError: null,
  closed: null,
});

const toView = (peer: PeerInfo): PeerView => ({
  id: peer.id,
  name: peer.name,
  sharing: peer.sharing,
  avatar: peer.avatar ?? null,
  status: 'connecting',
  connection: null,
  stream: null,
});

function updatePeer(state: RoomState, id: string, patch: Partial<PeerView>): RoomState {
  const peer = state.peers[id];
  // Eventos tardios de quem já saiu são ignorados.
  if (!peer) return state;
  return { ...state, peers: { ...state.peers, [id]: { ...peer, ...patch } } };
}

export function roomReducer(state: RoomState, action: RoomAction): RoomState {
  switch (action.type) {
    case 'phase':
      return { ...state, phase: action.phase };
    case 'joined':
      // Também vale para reentrada após queda do WS: as conexões com os peers são refeitas.
      return {
        ...state,
        selfId: action.selfId,
        selfName: action.selfName ?? null,
        reactions: action.reactions ?? null,
        roulette: action.roulette ?? null,
        everJoined: true,
        lastError: null,
        peers: Object.fromEntries(action.peers.map((peer) => [peer.id, toView(peer)])),
      };
    case 'roulette':
      return { ...state, roulette: action.roulette };
    case 'peer-joined':
      return { ...state, peers: { ...state.peers, [action.peer.id]: toView(action.peer) } };
    case 'peer-left': {
      if (!state.peers[action.id]) return state;
      const peers = Object.fromEntries(
        Object.entries(state.peers).filter(([id]) => id !== action.id),
      );
      return { ...state, peers };
    }
    case 'peer-sharing':
      return updatePeer(state, action.id, { sharing: action.active });
    case 'peer-avatar':
      return updatePeer(state, action.id, { avatar: action.avatar });
    case 'peer-status':
      return updatePeer(state, action.id, { status: action.status });
    case 'peer-connection':
      return updatePeer(state, action.id, { connection: action.info });
    case 'peer-stream':
      return updatePeer(state, action.id, { stream: action.stream });
    case 'error':
      return { ...state, lastError: action.code };
    case 'ice-fallback':
      return { ...state, iceFallback: action.fallback };
    case 'share-rejected':
      return { ...state, shareRejections: state.shareRejections + 1 };
    case 'closed':
      return { ...state, closed: action.reason };
  }
}

/** Peers cujo tile deve aparecer: estão compartilhando ou ainda há stream para mostrar. */
export const sharingPeers = (state: RoomState): PeerView[] =>
  Object.values(state.peers).filter((peer) => peer.sharing || peer.stream !== null);

export const allPeers = (state: RoomState): PeerView[] =>
  Object.values(state.peers).sort((a, b) => a.name.localeCompare(b.name));

// ---------------------------------------------------------------------------
// Textos
// ---------------------------------------------------------------------------

export const PEER_STATUS_LABEL: Record<PeerStatus, string> = {
  connecting: 'conectando',
  p2p: 'direto (P2P)',
  relay: 'via relay (TURN)',
  failed: 'falhou',
};

const KIND_LABEL: Record<string, string> = {
  host: 'direto (rede local ou IPv6)',
  srflx: 'direto via NAT (STUN)',
  prflx: 'direto via NAT',
  relay: 'relay (TURN)',
  unknown: 'desconhecido',
};

/**
 * Texto do selo de conexão. Relay por UDP continua "via relay (TURN)"; relay por TCP/TLS é
 * destacado porque costuma deixar o vídeo bem pior (TCP trava e re-envia pacotes de vídeo).
 */
export function describeConnectionLabel(status: PeerStatus, info: ConnectionInfo | null): string {
  if (status === 'relay' && (info?.relayProtocol === 'tcp' || info?.relayProtocol === 'tls')) {
    return `via relay (TURN/${info.relayProtocol.toUpperCase()})`;
  }
  return PEER_STATUS_LABEL[status];
}

/** Explicação do caminho para o balão (`title`) do selo; `undefined` enquanto não se sabe. */
export function describeConnectionDetail(info: ConnectionInfo | null): string | undefined {
  if (!info) return undefined;
  const parts = [
    `Seu lado: ${KIND_LABEL[info.local] ?? info.local}${info.ipv6 ? ', IPv6' : ''}`,
    `Do outro lado: ${KIND_LABEL[info.remote] ?? info.remote}`,
  ];
  if (info.relayProtocol) {
    parts.push(
      info.relayProtocol === 'udp'
        ? 'Relay por UDP (o ideal para vídeo)'
        : `Relay por ${info.relayProtocol.toUpperCase()}: pior para vídeo (a rede bloqueia UDP)`,
    );
  } else if (info.type === 'relay') {
    parts.push('O relay está do lado do outro participante');
  }
  return parts.join(' · ');
}

export function describeServerError(code: ErrorCode): string {
  switch (code) {
    case 'ROOM_FULL':
      return 'Sala cheia. Tente outra sala.';
    case 'NAME_TAKEN':
      return 'Já existe alguém com esse nome na sala. Escolha outro nome.';
    case 'SHARE_BUSY':
      return 'Outra pessoa já está compartilhando. Aguarde ela parar.';
    case 'RATE_LIMITED':
      return 'Muitas mensagens em pouco tempo. Tente de novo.';
    case 'ALREADY_JOINED':
    case 'INVALID':
      return 'Erro de comunicação com o servidor.';
  }
}

/** Mensagem para mostrar no JoinForm quando a sala foi encerrada; `null` = saída normal. */
export function describeClose(reason: CloseReason, lastError: ErrorCode | null): string | null {
  switch (reason) {
    case 'disconnect':
      return null;
    case 'auth-expired':
      return 'Sua sessão expirou ou o servidor foi reiniciado. Entre novamente com a senha.';
    case 'server-shutdown':
      return 'O servidor foi desligado. Entre novamente quando ele voltar.';
    case 'rejected':
      return lastError ? describeServerError(lastError) : 'Não foi possível entrar na sala.';
    case 'replaced':
      return 'Você entrou nesta sala em outro lugar; esta conexão foi encerrada.';
    case 'policy':
      return 'Conexão encerrada pelo servidor.';
  }
}
