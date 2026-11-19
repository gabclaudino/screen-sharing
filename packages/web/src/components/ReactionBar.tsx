import type { ReactionEmoji } from '@screenshare/shared';

interface Props {
  /** Emojis dos botões, na ordem de exibição (configurados no servidor). */
  emojis: readonly ReactionEmoji[];
  onReact: (emoji: ReactionEmoji) => void;
  disabled?: boolean;
}

/** Botões de reação rápida; cada clique faz o emoji subir na tela de todo mundo. */
export function ReactionBar({ emojis, onReact, disabled = false }: Props) {
  return (
    <div className="reaction-bar" role="group" aria-label="Reações">
      {emojis.map((emoji) => (
        <button
          key={emoji}
          type="button"
          className="reaction-button"
          disabled={disabled}
          aria-label={`Reagir com ${emoji}`}
          onClick={() => onReact(emoji)}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}
