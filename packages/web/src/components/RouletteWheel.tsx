import type { RouletteState } from '@screenshare/shared';
import { useEffect, useRef, useState } from 'react';
import {
  pointAt,
  shortLabel,
  slicePath,
  sliceCenter,
  targetRotation,
  WHEEL_COLORS,
} from '../lib/roulette-wheel';
import { SPIN_EASING_CSS, tickTimes } from '../lib/roulette-ticks';
import { playTicks, type TickPlayer } from '../lib/tick-player';

interface Props {
  names: string[];
  spin: RouletteState['spin'];
  /** Último sorteado; mantém a roleta parada nele depois do giro. */
  winner: string | null;
  /** Toca o tec-tec (aba aberta e som ligado). */
  audible: boolean;
}

const RADIUS = 100;

/** `rest` é exatamente `list` sem `removed`? */
function isListWithout(list: string[], removed: string, rest: string[]): boolean {
  const expected = list.filter((name) => name !== removed);
  return (
    expected.length === list.length - 1 &&
    expected.length === rest.length &&
    expected.every((name, index) => name === rest[index])
  );
}

export function RouletteWheel({ names: entries, spin, winner, audible }: Props) {
  const discRef = useRef<SVGGElement>(null);
  const rotationRef = useRef(0);
  const [rotation, setRotation] = useState(0);

  // As fatias do último giro: o sorteado já saiu de `entries`, mas a roleta continua mostrando onde
  // parou até o próximo giro (ou até alguém mexer na lista).
  const [spun, setSpun] = useState<{ seq: number; names: string[] } | null>(null);
  if (spin && spun?.seq !== spin.seq) setSpun({ seq: spin.seq, names: entries });
  const stopped =
    !spin && winner !== null && spun !== null && isListWithout(spun.names, winner, entries);
  const names = stopped ? spun.names : entries;

  // Cada giro novo (seq) anima a partir de onde a roleta parou. Web Animations em vez de transição
  // CSS: o giro continua contando mesmo com a aba da roleta escondida.
  const seq = spin?.seq;
  const spinRef = useRef(spin);
  const countRef = useRef(names.length);
  const audibleRef = useRef(audible);
  const ticksRef = useRef<TickPlayer | null>(null);
  useEffect(() => {
    spinRef.current = spin;
    countRef.current = names.length;
    audibleRef.current = audible;
    ticksRef.current?.setAudible(audible);
  });
  useEffect(() => {
    const current = spinRef.current;
    if (!current) return;
    const from = rotationRef.current;
    const to = targetRotation(from, current.index, countRef.current);
    rotationRef.current = to;
    setRotation(to);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const animation = reduced
      ? undefined
      : discRef.current?.animate?.(
          [{ transform: `rotate(${from}deg)` }, { transform: `rotate(${to}deg)` }],
          { duration: current.ms, easing: SPIN_EASING_CSS },
        );
    // Sem animação (movimento reduzido) não há o que acompanhar com som.
    const ticks = reduced
      ? null
      : playTicks(
          tickTimes({ from, to, count: countRef.current, durationMs: current.ms }),
          audibleRef.current,
        );
    ticksRef.current = ticks;
    return () => {
      animation?.cancel();
      ticks?.stop();
    };
  }, [seq]);

  const count = names.length;
  const label =
    count === 0 ? 'Roleta vazia' : `Roleta com ${count} ${count === 1 ? 'nome' : 'nomes'}`;

  return (
    <div className="wheel">
      <svg viewBox="-108 -108 216 216" role="img" aria-label={label}>
        <circle r={RADIUS + 5} className="wheel-rim" />
        <g ref={discRef} style={{ transform: `rotate(${rotation}deg)` }}>
          {count === 0 ? <circle r={RADIUS} className="wheel-empty" /> : null}
          {count === 1 ? <circle r={RADIUS} fill={WHEEL_COLORS[0]} /> : null}
          {count > 1
            ? names.map((name, index) => (
                <path
                  key={name}
                  d={slicePath(index, count, RADIUS)}
                  fill={WHEEL_COLORS[index % WHEEL_COLORS.length]}
                  className={stopped && name !== winner ? 'wheel-slice wheel-dim' : 'wheel-slice'}
                />
              ))
            : null}
          {names.map((name, index) => {
            // Texto ao longo do raio; do lado esquerdo vira, para não ficar de cabeça para baixo.
            const angle = sliceCenter(index, count);
            const at = pointAt(angle, RADIUS * 0.58);
            return (
              <text
                key={name}
                className="wheel-label"
                transform={`translate(${at.x} ${at.y}) rotate(${angle > 180 ? angle + 90 : angle - 90})`}
              >
                {shortLabel(name)}
              </text>
            );
          })}
        </g>
        <circle r={9} className="wheel-hub" />
        <path d="M-9 -108L9 -108L0 -90Z" className="wheel-pointer" />
      </svg>
      {count === 0 ? <p className="wheel-hint">Adicione nomes para montar a roleta</p> : null}
    </div>
  );
}
