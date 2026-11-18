import type { ContentHint } from '../hooks/useScreenShare';

const BITRATE_OPTIONS = [
  { value: 1_000_000, label: '1 Mbps (economia)' },
  { value: 2_500_000, label: '2,5 Mbps (padrão)' },
  { value: 5_000_000, label: '5 Mbps (alta qualidade)' },
];

interface Props {
  sharing: boolean;
  captureSupported: boolean;
  /** Nome de quem já está compartilhando (só uma pessoa por vez); bloqueia o botão. */
  blockedBy: string | null;
  audio: boolean;
  onAudioChange: (value: boolean) => void;
  contentHint: ContentHint;
  onContentHintChange: (value: ContentHint) => void;
  bitrate: number;
  onBitrateChange: (value: number) => void;
  showLocalPreview: boolean;
  onShowLocalPreviewChange: (value: boolean) => void;
  onToggleShare: () => void;
}

export function Controls(props: Props) {
  const { sharing, captureSupported, blockedBy } = props;
  return (
    <div className="controls" role="toolbar" aria-label="Controles da sala">
      <button
        type="button"
        className={sharing ? 'danger' : 'primary'}
        disabled={!captureSupported || blockedBy !== null}
        onClick={props.onToggleShare}
      >
        {sharing
          ? 'Parar de compartilhar'
          : blockedBy
            ? `${blockedBy} está compartilhando`
            : 'Compartilhar tela'}
      </button>

      <label className="inline">
        <input
          type="checkbox"
          checked={props.audio}
          disabled={sharing}
          onChange={(event) => props.onAudioChange(event.target.checked)}
        />
        Áudio do sistema
      </label>

      <label className="inline">
        Tipo
        <select
          value={props.contentHint}
          onChange={(event) => props.onContentHintChange(event.target.value as ContentHint)}
        >
          <option value="detail">Texto / código (nitidez)</option>
          <option value="motion">Movimento (jogos / vídeo)</option>
        </select>
      </label>

      <label className="inline">
        Qualidade
        <select
          value={props.bitrate}
          onChange={(event) => props.onBitrateChange(Number(event.target.value))}
        >
          {BITRATE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {sharing ? (
        <label className="inline">
          <input
            type="checkbox"
            checked={props.showLocalPreview}
            onChange={(event) => props.onShowLocalPreviewChange(event.target.checked)}
          />
          Ver minha tela
        </label>
      ) : null}
    </div>
  );
}
