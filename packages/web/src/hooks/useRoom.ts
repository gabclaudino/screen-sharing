import type { ReactionEmoji } from '@screenshare/shared';
import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { Session } from '../lib/auth';
import { IceServerStore } from '../lib/ice';
import { PeerManager } from '../lib/peer-manager';
import { createInitialRoomState, roomReducer, type RoomState } from '../lib/room-state';
import { buildWsUrl, SignalingClient } from '../lib/signaling-client';

export interface UseRoomParams {
  name: string;
  session: Session;
  /** Reação de outra pessoa chegou (a UI mostra o emoji subindo na tela). */
  onReaction?: (from: string, emoji: ReactionEmoji) => void;
}

export interface UseRoomResult {
  state: RoomState;
  /** Começa (stream) ou para (`null`) de enviar a tela local a todos os peers. */
  setLocalStream: (stream: MediaStream | null) => void;
  setMaxBitrate: (bitsPerSecond: number) => void;
  /** Manda a reação a todos; `false` se não estiver conectado. */
  sendReaction: (emoji: ReactionEmoji) => boolean;
}

const DEFAULT_BITRATE = 2_500_000;

/** Liga SignalingClient + PeerManager ao estado da UI e cuida do ciclo de vida de ambos. */
export function useRoom({ name, session, onReaction }: UseRoomParams): UseRoomResult {
  const [state, dispatch] = useReducer(roomReducer, undefined, createInitialRoomState);

  const clientRef = useRef<SignalingClient | null>(null);
  const managerRef = useRef<PeerManager | null>(null);
  const sessionRef = useRef(session);
  const sharingRef = useRef(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const bitrateRef = useRef(DEFAULT_BITRATE);

  const onReactionRef = useRef(onReaction);

  useEffect(() => {
    sessionRef.current = session;
    onReactionRef.current = onReaction;
  }, [session, onReaction]);

  useEffect(() => {
    const client = new SignalingClient({
      url: buildWsUrl(window.location),
      name,
      getSession: () => sessionRef.current,
      // Reentrando após queda do WS enquanto ainda compartilha: o servidor precisa saber.
      getSharing: () => sharingRef.current,
    });
    const ice = new IceServerStore({
      getSession: () => sessionRef.current,
      onFallbackChange: (fallback) => dispatch({ type: 'ice-fallback', fallback }),
    });
    const manager = new PeerManager({
      sendSignal: (to, data) => client.sendSignal(to, data),
      getIceServers: () => ice.get(),
      maxBitrate: bitrateRef.current,
    });
    clientRef.current = client;
    managerRef.current = manager;
    if (localStreamRef.current) manager.setLocalStream(localStreamRef.current);

    const off = [
      client.on('status', (phase) => dispatch({ type: 'phase', phase })),
      client.on('joined', ({ selfId, selfName, reactions, peers }) => {
        // selfId novo (primeira vez ou reconexão): todas as conexões P2P são refeitas.
        manager.setSelf(selfId, peers);
        dispatch({ type: 'joined', selfId, selfName, reactions, peers });
      }),
      client.on('peer-joined', (peer) => {
        manager.addPeer(peer);
        dispatch({ type: 'peer-joined', peer });
      }),
      client.on('peer-left', (id) => {
        manager.removePeer(id);
        dispatch({ type: 'peer-left', id });
      }),
      client.on('peer-sharing', ({ id, active }) => dispatch({ type: 'peer-sharing', id, active })),
      client.on('reaction', ({ from, emoji }) => onReactionRef.current?.(from, emoji)),
      client.on('signal', ({ from, data }) => manager.handleSignal(from, data)),
      client.on('error', ({ code }) =>
        // SHARE_BUSY não encerra nada: só avisa a UI para parar a captura local.
        dispatch(code === 'SHARE_BUSY' ? { type: 'share-rejected' } : { type: 'error', code }),
      ),
      client.on('closed', ({ reason }) => dispatch({ type: 'closed', reason })),
      manager.on('remote-stream', ({ peerId, stream }) =>
        dispatch({ type: 'peer-stream', id: peerId, stream }),
      ),
      manager.on('status', ({ peerId, status }) =>
        dispatch({ type: 'peer-status', id: peerId, status }),
      ),
    ];

    // Busca os iceServers (STUN + TURN) antes de conectar: nenhuma conexão P2P pode nascer sem
    // eles. Se a busca falhar, segue só com STUN e a UI avisa (state.iceFallback).
    let cancelled = false;
    void ice.refresh().then(() => {
      if (cancelled) return;
      client.connect();
      ice.startAutoRefresh();
    });

    return () => {
      cancelled = true;
      ice.stop();
      // Desinscreve antes de desconectar: o `closed` do disconnect() não deve chegar à UI.
      off.forEach((unsubscribe) => unsubscribe());
      manager.closeAll();
      client.disconnect();
      clientRef.current = null;
      managerRef.current = null;
    };
  }, [name]);

  const setLocalStream = useCallback((stream: MediaStream | null) => {
    localStreamRef.current = stream;
    sharingRef.current = stream !== null;
    managerRef.current?.setLocalStream(stream);
    clientRef.current?.sendSharing(stream !== null);
  }, []);

  const setMaxBitrate = useCallback((bitsPerSecond: number) => {
    bitrateRef.current = bitsPerSecond;
    managerRef.current?.setMaxBitrate(bitsPerSecond);
  }, []);

  const sendReaction = useCallback(
    (emoji: ReactionEmoji) => clientRef.current?.sendReaction(emoji) ?? false,
    [],
  );

  return { state, setLocalStream, setMaxBitrate, sendReaction };
}
