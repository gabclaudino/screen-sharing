import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { clampMenuPosition } from '../lib/menu-position';
import type { PeerStatus } from '../lib/peer-link';
import { loadPlayback, savePlayback, type Playback } from '../lib/profile';
import { PEER_STATUS_LABEL } from '../lib/room-state';
import { EnterFullscreenIcon, ExitFullscreenIcon } from './icons';
import { TILE_MENU_SIZE, TileAudioMenu } from './TileAudioMenu';

interface Props {
  stream: MediaStream | null;
  label: string;
  /** Prévia local: sempre muda (senão haveria eco do próprio áudio) e sem menu de áudio. */
  local?: boolean;
  status?: PeerStatus;
}

export function VideoTile({ stream, label, local = false, status }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [playback, setPlayback] = useState<Playback>(() => loadPlayback());
  const [menu, setMenu] = useState<{ left: number; top: number } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  // Volume e mudo no <video>. Declarado antes do efeito de play(): na montagem roda primeiro,
  // então o play() já parte com o estado de áudio certo.
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = playback.volume / 100;
    video.muted = local || playback.muted || soundBlocked;
  }, [stream, local, playback, soundBlocked]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    setSoundBlocked(false);
    if (!stream) return;

    let cancelled = false;
    video.play().catch(() => {
      if (cancelled) return;
      // Política de autoplay bloqueou o som: toca mudo e oferece o botão de ativar.
      video.muted = true;
      setSoundBlocked(!local);
      video.play().catch((error: unknown) => console.warn('[video] play falhou:', error));
    });
    return () => {
      cancelled = true;
      video.srcObject = null;
    };
  }, [stream, local]);

  // Lembra volume/mudo entre transmissões e visitas.
  useEffect(() => {
    if (!local) savePlayback(playback);
  }, [playback, local]);

  // Acompanha a tela cheia também quando ela é encerrada com Esc.
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  function enableSound() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = false;
    setSoundBlocked(false);
    setPlayback((current) => ({ ...current, muted: false }));
    video.play().catch((error: unknown) => console.warn('[video] play falhou:', error));
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      containerRef.current?.requestFullscreen().catch((error: unknown) => {
        console.warn('[video] tela cheia indisponível:', error);
      });
    }
  }

  // Clique direito: substitui o menu do navegador (salvar vídeo etc.) pelo de áudio.
  function openMenu(event: MouseEvent<HTMLDivElement>) {
    if (local) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setMenu(
      clampMenuPosition(
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        TILE_MENU_SIZE,
        { width: rect.width, height: rect.height },
      ),
    );
  }

  return (
    <div
      className="tile"
      ref={containerRef}
      onDoubleClick={toggleFullscreen}
      onContextMenu={openMenu}
    >
      <video ref={videoRef} autoPlay playsInline muted={local} />
      {stream === null ? (
        <div className="tile-placeholder">Conectando à tela de {label}…</div>
      ) : null}
      <div className="tile-bar">
        <span className="tile-label">
          {label}
          {local ? ' (prévia)' : ''}
        </span>
        {status ? (
          <span className={`badge badge-${status}`}>{PEER_STATUS_LABEL[status]}</span>
        ) : null}
        <span className="tile-actions">
          {soundBlocked ? (
            <button type="button" onClick={enableSound}>
              Ativar som
            </button>
          ) : null}
          <button
            type="button"
            className="icon-button"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
            title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          >
            {fullscreen ? <ExitFullscreenIcon /> : <EnterFullscreenIcon />}
          </button>
        </span>
      </div>

      {menu ? (
        <TileAudioMenu
          left={menu.left}
          top={menu.top}
          volume={playback.volume}
          muted={playback.muted}
          onVolumeChange={(volume) => setPlayback({ volume, muted: volume === 0 })}
          onMutedChange={(muted) =>
            setPlayback((current) => ({
              // Tirar do mudo com o volume em 0 voltaria silencioso: sobe para um nível audível.
              volume: !muted && current.volume === 0 ? 50 : current.volume,
              muted,
            }))
          }
          onClose={closeMenu}
        />
      ) : null}
    </div>
  );
}
