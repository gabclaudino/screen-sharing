import type { ErrorCode, PeerInfo } from '@screenshare/shared';
import type { PeerStatus } from './peer-link';
import type { CloseReason, SignalingStatus } from './signaling-client';

/** O que a UI sabe de cada participante remoto. */
export interface PeerView {
  id: string;
  name: string;
  sharing: boolean;
  status: PeerStatus;
  stream: MediaStream | null;
}

export interface RoomState {
  phase: SignalingStatus;
  selfId: string | null;
  peers: Record<string, PeerView>;
  /** true depois do primeiro `joined`; distingue "conectando pela 1ª vez" de "reconectando". */
  everJoined: boolean;
  /** Quantas vezes o servidor recusou um compartilhamento (SHARE_BUSY); a UI reage a cada uma. */
  shareRejections: number;
  /** Último erro enviado pelo servidor (sala cheia, nome em uso...). */
  lastError: ErrorCode | null;
  closed: CloseReason | null;
}

export type RoomAction =
  | { type: 'phase'; phase: SignalingStatus }
  | { type: 'joined'; selfId: string; peers: PeerInfo[] }
  | { type: 'peer-joined'; peer: PeerInfo }
  | { type: 'peer-left'; id: string }
  | { type: 'peer-sharing'; id: string; active: boolean }
  | { type: 'peer-status'; id: string; status: PeerStatus }
  | { type: 'peer-stream'; id: string; stream: MediaStream | null }
  | { type: 'error'; code: ErrorCode }
  | { type: 'share-rejected' }
  | { type: 'closed'; reason: CloseReason };

export const createInitialRoomState = (): RoomState => ({
  phase: 'idle',
  selfId: null,
  peers: {},
  everJoined: false,
  shareRejections: 0,
  lastError: null,
  closed: null,
});

const toView = (peer: PeerInfo): PeerView => ({
  id: peer.id,
  name: peer.name,
  sharing: peer.sharing,
  status: 'connecting',
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
        everJoined: true,
        lastError: null,
        peers: Object.fromEntries(action.peers.map((peer) => [peer.id, toView(peer)])),
      };
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
    case 'peer-status':
      return updatePeer(state, action.id, { status: action.status });
    case 'peer-stream':
      return updatePeer(state, action.id, { stream: action.stream });
    case 'error':
      return { ...state, lastError: action.code };
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
      return 'Sua sessão expirou. Entre novamente.';
    case 'rejected':
      return lastError ? describeServerError(lastError) : 'Não foi possível entrar na sala.';
    case 'replaced':
      return 'Você entrou nesta sala em outro lugar; esta conexão foi encerrada.';
    case 'policy':
      return 'Conexão encerrada pelo servidor.';
  }
}
