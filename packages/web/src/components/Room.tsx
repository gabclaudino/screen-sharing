import { DEFAULT_REACTION_EMOJIS, type ReactionEmoji } from '@screenshare/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRoom } from '../hooks/useRoom';
import { useScreenShare, type ContentHint } from '../hooks/useScreenShare';
import type { Session } from '../lib/auth';
import { findProfilePhoto } from '../lib/profile-photos';
import { hasSeenAudioGuide, loadAvatar, markAudioGuideSeen, saveAvatar } from '../lib/profile';
import {
  FLOATER_LIFETIME_MS,
  pushFloater,
  randomLeft,
  REACTION_COOLDOWN_MS,
  removeFloater,
  type Floater,
} from '../lib/reactions';
import {
  allPeers,
  describeClose,
  describeConnectionDetail,
  describeConnectionLabel,
  describeServerError,
  sharingPeers,
} from '../lib/room-state';
import { AudioGuideDialog } from './AudioGuideDialog';
import { Avatar } from './Avatar';
import { AvatarPicker } from './AvatarPicker';
import { LogOutIcon } from './icons';
import { Controls } from './Controls';
import { DontClickButton } from './DontClickButton';
import { ReactionBar } from './ReactionBar';
import { ReactionOverlay } from './ReactionOverlay';
import { VideoTile } from './VideoTile';

interface Props {
  name: string;
  session: Session;
  /** Volta ao formulário; `notice` explica por que (sessão expirada, sala cheia...). */
  onLeave: (notice?: string) => void;
}

export function Room({ name, session, onLeave }: Props) {
  // Foto de perfil: lembrada neste navegador; o `join` e cada troca a levam para a sala.
  const [avatar, setAvatar] = useState<string | null>(() => {
    const saved = loadAvatar();
    return findProfilePhoto(saved) ? saved : null;
  });
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const nextFloaterId = useRef(0);
  const lastReactionAt = useRef(0);
  const peerNames = useRef<Record<string, string>>({});

  const addFloater = useCallback((emoji: ReactionEmoji, label: string) => {
    nextFloaterId.current += 1;
    const floater = { id: nextFloaterId.current, emoji, label, left: randomLeft() };
    setFloaters((list) => pushFloater(list, floater));
    // Rede de segurança: aba em segundo plano pode não disparar o fim da animação.
    setTimeout(() => setFloaters((list) => removeFloater(list, floater.id)), FLOATER_LIFETIME_MS);
  }, []);
  const removeDoneFloater = useCallback(
    (id: number) => setFloaters((list) => removeFloater(list, id)),
    [],
  );
  const handleRemoteReaction = useCallback(
    (from: string, emoji: ReactionEmoji) => addFloater(emoji, peerNames.current[from] ?? ''),
    [addFloater],
  );

  const { state, setLocalStream, setMaxBitrate, sendReaction } = useRoom({
    name,
    session,
    avatar,
    onReaction: handleRemoteReaction,
  });
  useEffect(() => {
    peerNames.current = Object.fromEntries(Object.values(state.peers).map((p) => [p.id, p.name]));
  }, [state.peers]);

  function react(emoji: ReactionEmoji) {
    const now = Date.now();
    if (now - lastReactionAt.current < REACTION_COOLDOWN_MS) return;
    // Só mostra para si mesmo o que realmente foi enviado.
    if (!sendReaction(emoji)) return;
    lastReactionAt.current = now;
    addFloater(emoji, 'você');
  }

  const handleStop = useCallback(() => setLocalStream(null), [setLocalStream]);
  const share = useScreenShare({ onStart: setLocalStream, onStop: handleStop });

  // Desligado por padrão: numa call (Discord) o áudio do sistema inclui a voz dos amigos.
  const [audio, setAudio] = useState(false);
  const [contentHint, setContentHint] = useState<ContentHint>('detail');
  const [bitrate, setBitrate] = useState(2_500_000);
  const [showLocalPreview, setShowLocalPreview] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

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

  // O servidor pode ter trocado o nome digitado por um apelido: o que vale é o nome registrado.
  const myName = state.selfName ?? name;
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
        <h1>Tela dos Guri</h1>
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
            {showLocalTile ? <VideoTile stream={share.stream} label={myName} local /> : null}
            {tiles.map((peer) => (
              <VideoTile
                key={peer.id}
                stream={peer.stream}
                label={peer.name}
                status={peer.status}
                connection={peer.connection}
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
          <>
            {/* Telas largas: aviso centralizado. */}
            <div className="empty empty-wide">
              <p className="empty-title">Ninguém está compartilhando a tela agora</p>
              <p className="muted">Clique em “Compartilhar tela” ou aguarde alguém começar.</p>
            </div>
            {/* Celular: o player fica sempre no lugar, vazio, com o botão de tela cheia. */}
            <div className="grid stage-empty-narrow">
              <VideoTile
                stream={null}
                label=""
                placeholder="Ninguém está compartilhando a tela agora"
              />
            </div>
          </>
        )}
      </main>

      <aside className="sidebar">
        <h2>Participantes ({peers.length + 1})</h2>
        <ul className="participants">
          <li>
            <button
              type="button"
              className="avatar-button"
              aria-label="Trocar minha foto de perfil"
              title="Trocar minha foto de perfil"
              onClick={() => setPickerOpen(true)}
            >
              <Avatar photoId={avatar} name={myName} />
            </button>
            <span className="participant-name">{myName} (você)</span>
            {share.sharing ? (
              <span className="participant-badges">
                <span className="badge badge-sharing">compartilhando</span>
              </span>
            ) : null}
          </li>
          {peers.map((peer) => (
            <li key={peer.id}>
              <Avatar photoId={peer.avatar} name={peer.name} />
              <span className="participant-name">{peer.name}</span>
              <span className="participant-badges">
                {peer.sharing ? <span className="badge badge-sharing">compartilhando</span> : null}
                <span
                  className={`badge badge-${peer.status}`}
                  title={describeConnectionDetail(peer.connection)}
                >
                  {describeConnectionLabel(peer.status, peer.connection)}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </aside>

      <footer className="room-footer">
        {state.iceFallback ? (
          <p className="notice" role="status">
            Não foi possível obter os servidores de relay. Conexões entre redes restritivas (4G,
            empresa, faculdade) podem falhar; entre redes comuns continua funcionando.
          </p>
        ) : null}
        {share.supported ? (
          <>
            {share.error ? (
              <p className="error" role="alert">
                {share.error}
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
                Áudio do sistema ligado: se você está numa call (Discord), quem assiste ouvirá as
                vozes dos amigos de volta.{' '}
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
          </>
        ) : null}
        <div className="footer-row">
          <ReactionBar
            emojis={state.reactions ?? DEFAULT_REACTION_EMOJIS}
            onReact={react}
            disabled={state.phase !== 'connected'}
          />
          <DontClickButton />
        </div>
      </footer>

      <ReactionOverlay floaters={floaters} onDone={removeDoneFloater} />
      <AvatarPicker
        open={pickerOpen}
        current={avatar}
        onSelect={(photoId) => {
          setAvatar(photoId);
          saveAvatar(photoId);
        }}
        onClose={() => setPickerOpen(false)}
      />
      <AudioGuideDialog open={guideOpen} onClose={() => setGuideOpen(false)} />
    </div>
  );
}
