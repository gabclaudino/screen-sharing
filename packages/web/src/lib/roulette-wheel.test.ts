import { describe, expect, it } from 'vitest';
import { pointAt, shortLabel, slicePath, sliceCenter, targetRotation } from './roulette-wheel';

const normalize = (angle: number) => ((angle % 360) + 360) % 360;

describe('roleta (geometria)', () => {
  it('0 grau é o topo e o ângulo cresce em sentido horário', () => {
    expect(pointAt(0, 100)).toEqual({ x: 0, y: -100 });
    expect(pointAt(90, 100)).toEqual({ x: 100, y: -0 });
  });

  it('as fatias dividem o círculo por igual', () => {
    expect(sliceCenter(0, 4)).toBe(45);
    expect(slicePath(0, 4, 100)).toBe('M0 0L0 -100A100 100 0 0 1 100 0Z');
  });

  it('para com o meio da fatia sorteada sob o ponteiro, sempre girando para a frente', () => {
    let current = 0;
    for (const [index, count] of [
      [0, 10],
      [7, 10],
      [3, 9],
      [0, 1],
      [1, 2],
    ] as const) {
      const target = targetRotation(current, index, count);
      expect(normalize(target + sliceCenter(index, count))).toBeCloseTo(0);
      expect(target - current).toBeGreaterThanOrEqual(6 * 360);
      current = target;
    }
  });

  it('encurta nomes longos sem partir emojis', () => {
    expect(shortLabel('Ana')).toBe('Ana');
    expect(shortLabel('abcdefgh', 5)).toBe('abcd…');
    expect(shortLabel('😀😀😀', 3)).toBe('😀😀😀');
  });
});
