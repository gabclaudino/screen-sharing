/** Desaceleração do giro (cubic-bezier x1, y1, x2, y2), usada na animação e no som. */
export const SPIN_EASING = [0.12, 0.7, 0.08, 1] as const;

export const SPIN_EASING_CSS = `cubic-bezier(${SPIN_EASING.join(', ')})`;

/** Intervalo mínimo entre dois "tecs": no começo do giro passam fatias demais para se ouvir. */
export const MIN_TICK_GAP_MS = 45;

/** Um eixo da curva de Bézier de 0 a 1 com os controles `a` e `b`, no parâmetro `u`. */
const bezier = (u: number, a: number, b: number): number =>
  3 * (1 - u) * (1 - u) * u * a + 3 * (1 - u) * u * u * b + u * u * u;

/** Em que fração do tempo (0–1) o giro alcança a fração `progress` (0–1) do caminho. */
export function timeForProgress(progress: number): number {
  const [x1, y1, x2, y2] = SPIN_EASING;
  // A curva só cresce, então a busca binária no parâmetro basta.
  let low = 0;
  let high = 1;
  for (let i = 0; i < 40; i += 1) {
    const middle = (low + high) / 2;
    if (bezier(middle, y1, y2) < progress) low = middle;
    else high = middle;
  }
  return bezier((low + high) / 2, x1, x2);
}

export interface SpinPath {
  /** Rotação inicial e final em graus (`to` > `from`). */
  from: number;
  to: number;
  /** Quantidade de fatias. */
  count: number;
  durationMs: number;
}

/**
 * Momentos (ms desde o início) em que uma divisa entre fatias passa pelo ponteiro. As divisas ficam
 * sob o ponteiro quando a rotação é múltipla do tamanho da fatia.
 */
export function tickTimes({ from, to, count, durationMs }: SpinPath): number[] {
  if (count < 1 || to <= from || durationMs <= 0) return [];
  const size = 360 / count;
  const times: number[] = [];
  let previous = -Infinity;
  for (let i = Math.floor(from / size) + 1; i * size <= to; i += 1) {
    const time = timeForProgress((i * size - from) / (to - from)) * durationMs;
    if (time - previous < MIN_TICK_GAP_MS) continue;
    times.push(time);
    previous = time;
  }
  return times;
}
