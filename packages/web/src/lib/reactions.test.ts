import { describe, expect, it } from 'vitest';
import { MAX_FLOATERS, pushFloater, randomLeft, removeFloater, type Floater } from './reactions';

const make = (id: number): Floater => ({ id, emoji: '🔥', label: 'Ana', left: 50 });

describe('pushFloater', () => {
  it('acrescenta no fim sem alterar a lista original', () => {
    const list = [make(1)];
    const next = pushFloater(list, make(2));
    expect(next.map((f) => f.id)).toEqual([1, 2]);
    expect(list).toHaveLength(1);
  });

  it(`mantém só os ${MAX_FLOATERS} mais recentes`, () => {
    let list: Floater[] = [];
    for (let id = 1; id <= MAX_FLOATERS + 5; id += 1) list = pushFloater(list, make(id));
    expect(list).toHaveLength(MAX_FLOATERS);
    expect(list[0]?.id).toBe(6);
    expect(list.at(-1)?.id).toBe(MAX_FLOATERS + 5);
  });
});

describe('removeFloater', () => {
  it('remove só o emoji com aquele id', () => {
    expect(removeFloater([make(1), make(2), make(3)], 2).map((f) => f.id)).toEqual([1, 3]);
  });
});

describe('randomLeft', () => {
  it('fica entre 10 e 90', () => {
    expect(randomLeft(() => 0)).toBe(10);
    expect(randomLeft(() => 1)).toBe(90);
    expect(randomLeft(() => 0.5)).toBe(50);
  });
});
