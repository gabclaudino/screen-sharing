import type { Floater } from '../lib/reactions';

interface Props {
  floaters: readonly Floater[];
  onDone: (id: number) => void;
}

/** Camada decorativa por cima da sala: não captura cliques nem é lida por leitores de tela. */
export function ReactionOverlay({ floaters, onDone }: Props) {
  return (
    <div className="reaction-overlay" aria-hidden="true">
      {floaters.map((floater) => (
        <div
          key={floater.id}
          className="floater"
          style={{ left: `${floater.left}%` }}
          onAnimationEnd={() => onDone(floater.id)}
        >
          <span className="floater-emoji">{floater.emoji}</span>
          <span className="floater-label">{floater.label}</span>
        </div>
      ))}
    </div>
  );
}
