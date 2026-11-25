import {
  isValidName,
  NAME_MAX_LENGTH,
  ROULETTE_MAX_NAMES,
  type RouletteCommand,
  type RouletteState,
} from '@screenshare/shared';
import { useState, type FormEvent } from 'react';
import { loadEffectsMuted, saveEffectsMuted } from '../lib/profile';
import { SoundOffIcon, SoundOnIcon } from './icons';
import { RouletteWheel } from './RouletteWheel';

interface Props {
  roulette: RouletteState;
  selfId: string | null;
  /** Nome de quem controla a roleta; `null` se estiver livre. */
  ownerName: string | null;
  /** Sem conexão com o servidor, nada pode ser pedido. */
  disabled: boolean;
  onCommand: (command: RouletteCommand) => void;
  /** A aba da roleta está aberta (fora dela não há som). */
  visible?: boolean;
  /** Esta pessoa transmite com áudio: o tec-tec entraria na transmissão. */
  sharingAudio?: boolean;
}

const TEAM_TITLES = ['TIME 1', 'TIME 2'] as const;

export function RoulettePanel({
  roulette,
  selfId,
  ownerName,
  disabled,
  onCommand,
  visible = true,
  sharingAudio = false,
}: Props) {
  const [draft, setDraft] = useState('');
  // Vale só para quem clicou, e é lembrado neste navegador.
  const [muted, setMuted] = useState(() => loadEffectsMuted());
  const soundLabel = muted ? 'Ligar o som da roleta' : 'Silenciar o som da roleta';
  const { entries, teams, spin, last } = roulette;
  const isOwner = selfId !== null && roulette.ownerId === selfId;
  const spinning = spin !== null;
  const drawn = teams[0].length + teams[1].length;
  const total = entries.length + drawn;
  const locked = disabled || spinning;
  const name = draft.trim();
  const duplicated = [...entries, ...teams[0], ...teams[1]].some(
    (existing) => existing.toLowerCase() === name.toLowerCase(),
  );
  const full = total >= ROULETTE_MAX_NAMES;
  const nextTeam = TEAM_TITLES[drawn % 2 === 0 ? 0 : 1];

  function submit(event: FormEvent) {
    event.preventDefault();
    if (locked || full || duplicated || !isValidName(name)) return;
    onCommand({ action: 'add', name });
    setDraft('');
  }

  return (
    <div className="roulette">
      <section className="roulette-names" aria-label="Nomes da roleta">
        {roulette.ownerId === null ? (
          <>
            <p className="muted">A roleta está livre. Só uma pessoa controla por vez.</p>
            <button
              type="button"
              className="primary"
              disabled={disabled}
              onClick={() => onCommand({ action: 'claim' })}
            >
              Usar a roleta
            </button>
          </>
        ) : isOwner ? (
          <>
            <p className="roulette-owner">Você controla a roleta</p>
            <form className="roulette-form" onSubmit={submit}>
              <input
                type="text"
                value={draft}
                maxLength={NAME_MAX_LENGTH}
                placeholder="Nome do jogador"
                aria-label="Nome do jogador"
                disabled={disabled || full}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button type="submit" disabled={locked || full || duplicated || !isValidName(name)}>
                Adicionar
              </button>
            </form>
            {name !== '' && duplicated && !full ? (
              <p className="notice">Esse nome já está na lista.</p>
            ) : null}
          </>
        ) : (
          <p className="roulette-owner" role="status">
            {ownerName ?? 'Alguém'} está usando a roleta
          </p>
        )}

        <h2>
          Na roleta ({entries.length}) · {total}/{ROULETTE_MAX_NAMES} jogadores
        </h2>
        <ul className="roulette-list">
          {entries.map((entry) => (
            <li key={entry}>
              <span>{entry}</span>
              {isOwner ? (
                <button
                  type="button"
                  className="roulette-remove"
                  aria-label={`Remover ${entry}`}
                  title={`Remover ${entry}`}
                  disabled={locked}
                  onClick={() => onCommand({ action: 'remove', name: entry })}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section className="roulette-center" aria-label="Sorteio">
        <button
          type="button"
          className="roulette-sound"
          aria-label={soundLabel}
          title={soundLabel}
          onClick={() => {
            setMuted(!muted);
            saveEffectsMuted(!muted);
          }}
        >
          {muted ? <SoundOffIcon /> : <SoundOnIcon />}
        </button>
        <RouletteWheel
          names={entries}
          spin={spin}
          winner={last?.name ?? null}
          audible={visible && !muted}
        />
        {sharingAudio && !muted ? (
          <p className="hint hint-warning">
            Você transmite com áudio: o som da roleta entra na transmissão.
          </p>
        ) : null}
        <p className="roulette-result" role="status">
          {spinning ? (
            `Sorteando… vai para o ${nextTeam}`
          ) : last ? (
            <>
              <strong>{last.name}</strong> entrou no {TEAM_TITLES[last.team]}
            </>
          ) : entries.length > 0 ? (
            `O próximo sorteado vai para o ${nextTeam}`
          ) : (
            ''
          )}
        </p>
        {isOwner ? (
          <div className="roulette-actions">
            <button
              type="button"
              className="primary roulette-spin"
              disabled={locked || entries.length === 0}
              onClick={() => onCommand({ action: 'spin' })}
            >
              Girar
            </button>
            <button
              type="button"
              disabled={locked || drawn === 0}
              onClick={() => onCommand({ action: 'reset', clear: false })}
            >
              Sortear de novo
            </button>
            <button
              type="button"
              disabled={locked || total === 0}
              onClick={() => onCommand({ action: 'reset', clear: true })}
            >
              Limpar tudo
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onCommand({ action: 'release' })}
            >
              Liberar roleta
            </button>
          </div>
        ) : null}
      </section>

      <section className="roulette-teams" aria-label="Times">
        {TEAM_TITLES.map((title, team) => (
          <div key={title} className={`team team-${team + 1}`}>
            <h2>{title}</h2>
            <ol>
              {Array.from({ length: ROULETTE_MAX_NAMES / 2 }, (_, slot) => {
                const player = teams[team as 0 | 1][slot];
                return (
                  <li key={slot} className={player === undefined ? 'team-empty' : undefined}>
                    {player ?? '—'}
                  </li>
                );
              })}
            </ol>
          </div>
        ))}
      </section>
    </div>
  );
}
