import { useEffect, useRef } from 'react';

/** Tamanho aproximado do menu, para não deixá-lo vazar para fora do tile. */
export const TILE_MENU_SIZE = { width: 224, height: 104 };

interface Props {
  left: number;
  top: number;
  volume: number;
  muted: boolean;
  onVolumeChange: (volume: number) => void;
  onMutedChange: (muted: boolean) => void;
  onClose: () => void;
}

/** Menu do clique direito na transmissão: silenciar e volume (arrastando o controle). */
export function TileAudioMenu({
  left,
  top,
  volume,
  muted,
  onVolumeChange,
  onMutedChange,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  // Fecha ao clicar fora ou apertar Esc.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="tile-menu"
      style={{ left, top }}
      role="group"
      aria-label="Áudio da transmissão"
      // Não deixa o clique direito/duplo clique dentro do menu chegar ao tile (tela cheia).
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <label className="menu-row">
        <input
          type="checkbox"
          checked={muted}
          onChange={(event) => onMutedChange(event.target.checked)}
        />
        Silenciar
      </label>
      <label className="menu-volume">
        <span className="menu-volume-label">
          Volume
          <output>{muted ? 0 : volume}%</output>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={volume}
          onChange={(event) => onVolumeChange(Number(event.target.value))}
        />
      </label>
    </div>
  );
}
