import { describe, expect, it } from 'vitest';
import { MIN_TICK_GAP_MS, tickTimes, timeForProgress } from './roulette-ticks';
import { targetRotation } from './roulette-wheel';

describe('tec-tec da roleta', () => {
  const path = { from: 0, to: targetRotation(0, 3, 10), count: 10, durationMs: 5000 };

  it('a curva começa em 0, termina em 1 e anda depressa no começo', () => {
    expect(timeForProgress(0)).toBeCloseTo(0, 3);
    expect(timeForProgress(1)).toBeCloseTo(1, 3);
    expect(timeForProgress(0.5)).toBeLessThan(0.25);
  });

  it('os tecs saem em ordem, dentro do giro e nunca colados', () => {
    const times = tickTimes(path);
    expect(times.length).toBeGreaterThan(20);
    expect(times[0]).toBeGreaterThan(0);
    expect(times.at(-1)).toBeLessThanOrEqual(path.durationMs);
    for (let i = 1; i < times.length; i += 1) {
      expect((times[i] ?? 0) - (times[i - 1] ?? 0)).toBeGreaterThanOrEqual(MIN_TICK_GAP_MS);
    }
  });

  it('vão ficando espaçados conforme a roleta freia', () => {
    const times = tickTimes(path);
    const gap = (i: number) => (times.at(i) ?? 0) - (times.at(i - 1) ?? 0);
    expect(gap(-1)).toBeGreaterThan(gap(1) * 3);
  });

  it('conta uma divisa por fatia percorrida quando há tempo entre elas', () => {
    // Um quarto de volta lento com 8 fatias: passa por 2 divisas.
    expect(tickTimes({ from: 0, to: 90, count: 8, durationMs: 5000 })).toHaveLength(2);
  });

  it('sem fatias, sem caminho ou sem tempo não há tec', () => {
    expect(tickTimes({ ...path, count: 0 })).toEqual([]);
    expect(tickTimes({ ...path, to: 0 })).toEqual([]);
    expect(tickTimes({ ...path, durationMs: 0 })).toEqual([]);
  });
});
