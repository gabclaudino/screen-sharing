import { useCallback, useEffect, useState } from 'react';
import { useRoom } from '../hooks/useRoom';
import { useScreenShare, type ContentHint } from '../hooks/useScreenShare';
import { clearStoredSession, type Session } from '../lib/auth';
import { hasSeenAudioGuide, markAudioGuideSeen } from '../lib/profile';
import {
  allPeers,
  describeClose,
  describeServerError,
  PEER_STATUS_LABEL,
  sharingPeers,
} from '../lib/room-state';
import { AudioGuideDialog } from './AudioGuideDialog';
import { LogOutIcon } from './icons';
import { Controls } from './Controls';
import { VideoTile } from './VideoTile';

interface Props {
  name: string;
  session: Session;
  /** Volta ao formulário; `notice` explica por que (sessão expirada, sala cheia...). */
  onLeave: (notice?: string) => void;
}

export function Room({ name, session, onLeave }: Props) {
  const { state, setLocalStream, setMaxBitrate } = useRoom({ name, session });
  const handleStop = useCallback(() => setLocalStream(null), [setLocalStream]);
  const share = useScreenShare({ onStart: setLocalStream, onStop: handleStop });

  // Desligado por padrão: numa call (Discord) o áudio do sistema inclui a voz dos amigos.
  const [audio, setAudio] = useState(false);
  const [contentHint, setContentHint] = useState<ContentHint>('detail');
  const [bitrate, setBitrate] = useState(2_500_000);
  const [showLocalPreview, setShowLocalPreview] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);

  useEffect(() => setMaxBitrate(bitrate), [bitrate, setMaxBitrate]);

  // Sala encerrada pelo servidor/cliente: volta ao formulário explicando o motivo.
  useEffect(() => {
    if (state.closed && state.closed !== 'disconnect') {
      onLeave(describeClose(state.closed, state.lastError) ?? undefined);
    }
  }, [state.closed, state.lastError, onLeave]);

  // O servidor recusou (ex.: duas pessoas clicaram juntas): solta a captura local.
  const stopShare = share.stop;
  useEffect(() => {
    if (state.shareRejections > 0) {
      stopShare();
      setShareNote(describeServerError('SHARE_BUSY'));
    }
  }, [state.shareRejections, stopShare]);

  function toggleShare() {
    if (share.sharing) {
      share.stop();
    } else if (!blockedBy) {
      setShareNote(null);
      void share.start({ audio, contentHint });
    }
  }

  // O guia de eco abre sozinho só na primeira vez que o áudio é ligado; depois, pelo botão.
  function changeAudio(enabled: boolean) {
    setAudio(enabled);
    if (enabled && !hasSeenAudioGuide()) {
      markAudioGuideSeen();
      setGuideOpen(true);
    }
  }

  function changeContentHint(hint: ContentHint) {
    setContentHint(hint);
    share.setContentHint(hint); // vale na hora, mesmo durante o compartilhamento
  }

  const tiles = sharingPeers(state);
  const peers = allPeers(state);
  const showLocalTile = showLocalPreview && share.stream !== null;
  const showGrid = tiles.length > 0 || showLocalTile;
  // Uma pessoa por vez: enquanto outra transmite, o botão fica bloqueado com o nome dela.
  const blockedBy = share.sharing ? null : (peers.find((peer) => peer.sharing)?.name ?? null);
  const stuckConnecting = state.phase === 'reconnecting' && !state.everJoined;

  return (
    <div className="room">
      <header className="room-header">
        <h1>ScreenShare Mesh</h1>
        {state.phase !== 'connected' ? (
          <p className="banner" role="status">
            {state.everJoined
              ? 'Reconectando ao servidor… as conexões diretas continuam.'
              : 'Conectando…'}
            {stuckConnecting ? (
              <>
                {' '}
                Não está conectando? Sua sessão pode ter expirado.{' '}
                <button
                  type="button"
                  onClick={() => {
                    clearStoredSession();
                    onLeave('Entre novamente com a senha.');
                  }}
                >
                  Voltar ao login
                </button>
              </>
            ) : null}
          </p>
        ) : null}
        <button type="button" className="leave-button" onClick={() => onLeave()}>
          <LogOutIcon />
          Sair
        </button>
      </header>

      <main className="stage">
        {showGrid ? (
          <div className="grid">
            {showLocalTile ? <VideoTile stream={share.stream} label={name} local /> : null}
            {tiles.map((peer) => (
              <VideoTile
                key={peer.id}
                stream={peer.stream}
                label={peer.name}
                status={peer.status}
              />
            ))}
          </div>
        ) : share.sharing ? (
          <div className="empty empty-sharing">
            <p className="empty-title">Você está compartilhando sua tela</p>
            <p>
              {peers.length === 0
                ? 'Ninguém mais está na sala ainda.'
                : peers.length === 1
                  ? '1 pessoa na sala pode ver.'
                  : `${peers.length} pessoas na sala podem ver.`}
            </p>
            <p className="muted">
              Para parar, use o botão abaixo ou o aviso do navegador. Marque “Ver minha tela” para
              conferir a prévia (se compartilhar a tela inteira, ela aparece dentro dela mesma).
            </p>
          </div>
        ) : (
          <div className="empty">
            <p className="empty-title">Ninguém está compartilhando a tela agora</p>
            <p className="muted">Clique em “Compartilhar tela” ou aguarde alguém começar.</p>
          </div>
        )}
      </main>

      <aside className="sidebar">
        <h2>Participantes ({peers.length + 1})</h2>
        <ul className="participants">
          <li>
            <span>{name} (você)</span>
            {share.sharing ? <span className="badge badge-sharing">compartilhando</span> : null}
          </li>
          {peers.map((peer) => (
            <li key={peer.id}>
              <span>{peer.name}</span>
              {peer.sharing ? <span className="badge badge-sharing">compartilhando</span> : null}
              <span className={`badge badge-${peer.status}`}>{PEER_STATUS_LABEL[peer.status]}</span>
            </li>
          ))}
        </ul>
      </aside>

      <footer className="room-footer">
        {share.error ? (
          <p className="error" role="alert">
            {share.error}
          </p>
        ) : null}
        {!share.supported ? (
          <p className="error" role="alert">
            Este navegador não suporta compartilhamento de tela (celulares só assistem).
          </p>
        ) : null}
        {share.audioMissing ? (
          <p className="notice" role="status">
            Nenhum áudio foi capturado. No Chrome/Edge, marque “Compartilhar áudio” na janela de
            seleção.
          </p>
        ) : null}
        {shareNote ? (
          <p className="notice" role="status">
            {shareNote}
          </p>
        ) : null}
        {audio ? (
          <p className="hint hint-warning">
            Áudio do sistema ligado: se você está numa call (Discord), quem assiste ouvirá as vozes
            dos amigos de volta.{' '}
            <button type="button" className="link" onClick={() => setGuideOpen(true)}>
              Ver guia para evitar o eco
            </button>
          </p>
        ) : null}
        <Controls
          sharing={share.sharing}
          captureSupported={share.supported}
          blockedBy={blockedBy}
          audio={audio}
          onAudioChange={changeAudio}
          contentHint={contentHint}
          onContentHintChange={changeContentHint}
          bitrate={bitrate}
          onBitrateChange={setBitrate}
          showLocalPreview={showLocalPreview}
          onShowLocalPreviewChange={setShowLocalPreview}
          onToggleShare={toggleShare}
        />
      </footer>

      <AudioGuideDialog open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
