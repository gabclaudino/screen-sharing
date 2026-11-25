import { ROULETTE_MAX_NAMES } from '@screenshare/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Roulette } from './roulette';

const SPIN_MS = 1000;

describe('Roulette', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function make(pick: (max: number) => number = () => 0) {
    const onResolve = vi.fn();
    const roulette = new Roulette({ onResolve, pick, spinMs: SPIN_MS });
    roulette.claim('dono');
    return { roulette, onResolve };
  }

  function fill(roulette: Roulette, count: number) {
    for (let i = 1; i <= count; i += 1) roulette.add('dono', `J${i}`);
  }

  function draw(roulette: Roulette) {
    expect(roulette.start('dono')).toBe(true);
    vi.advanceTimersByTime(SPIN_MS);
  }

  it('só uma pessoa controla; os outros não mexem em nada', () => {
    const { roulette } = make();
    fill(roulette, 2);
    expect(roulette.claim('outro')).toBe(false);
    expect(roulette.add('outro', 'X')).toBe(false);
    expect(roulette.remove('outro', 'J1')).toBe(false);
    expect(roulette.start('outro')).toBe(false);
    expect(roulette.reset('outro', true)).toBe(false);
    expect(roulette.release('outro')).toBe(false);
    expect(roulette.toState().entries).toEqual(['J1', 'J2']);

    expect(roulette.release('dono')).toBe(true);
    expect(roulette.claim('outro')).toBe(true);
    // A lista fica para quem assumir.
    expect(roulette.toState().entries).toEqual(['J1', 'J2']);
  });

  it('recusa nome repetido (sem diferenciar maiúsculas) e passa de 10', () => {
    const { roulette } = make();
    expect(roulette.add('dono', 'Ana')).toBe(true);
    expect(roulette.add('dono', 'ANA')).toBe(false);
    fill(roulette, ROULETTE_MAX_NAMES - 1);
    expect(roulette.add('dono', 'Sobrando')).toBe(false);
    // Quem já foi sorteado também conta no limite e na repetição.
    draw(roulette);
    expect(roulette.add('dono', 'Ana')).toBe(false);
    expect(roulette.add('dono', 'Sobrando')).toBe(false);
  });

  it('um sorteado por giro, alternando TIME 1 e TIME 2 até 5 contra 5', () => {
    const { roulette, onResolve } = make();
    fill(roulette, 10);
    for (let i = 0; i < 10; i += 1) draw(roulette);
    const state = roulette.toState();
    expect(state.teams).toEqual([
      ['J1', 'J3', 'J5', 'J7', 'J9'],
      ['J2', 'J4', 'J6', 'J8', 'J10'],
    ]);
    expect(state.entries).toEqual([]);
    expect(state.last).toEqual({ name: 'J10', team: 1 });
    expect(onResolve).toHaveBeenCalledTimes(10);
    expect(roulette.start('dono')).toBe(false);
  });

  it('o resultado só sai no fim do giro e nada muda enquanto gira', () => {
    const { roulette, onResolve } = make(() => 2);
    fill(roulette, 3);
    roulette.start('dono');
    vi.advanceTimersByTime(400);
    expect(roulette.toState()).toMatchObject({
      entries: ['J1', 'J2', 'J3'],
      teams: [[], []],
      spin: { seq: 1, index: 2, ms: 600 },
    });
    expect(roulette.start('dono')).toBe(false);
    expect(roulette.add('dono', 'Z')).toBe(false);
    expect(roulette.remove('dono', 'J1')).toBe(false);
    expect(roulette.reset('dono', true)).toBe(false);
    expect(onResolve).not.toHaveBeenCalled();

    vi.advanceTimersByTime(600);
    expect(roulette.toState()).toMatchObject({
      entries: ['J1', 'J2'],
      teams: [['J3'], []],
      spin: null,
      last: { name: 'J3', team: 0 },
    });
  });

  it('o giro termina mesmo se o dono sair no meio', () => {
    const { roulette, onResolve } = make();
    fill(roulette, 2);
    roulette.start('dono');
    roulette.release('dono');
    vi.advanceTimersByTime(SPIN_MS);
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(roulette.toState().teams[0]).toEqual(['J1']);
  });

  it('sortear de novo devolve todos à roleta; limpar apaga a lista', () => {
    const { roulette } = make();
    fill(roulette, 3);
    draw(roulette);
    draw(roulette);
    expect(roulette.reset('dono', false)).toBe(true);
    expect(roulette.toState()).toMatchObject({ teams: [[], []], last: null });
    expect([...roulette.toState().entries].sort()).toEqual(['J1', 'J2', 'J3']);
    roulette.reset('dono', true);
    expect(roulette.toState().entries).toEqual([]);
  });

  it('clear cancela o giro e volta ao zero; handover passa o controle', () => {
    const { roulette, onResolve } = make();
    fill(roulette, 2);
    expect(roulette.handover('dono', 'dono-2')).toBe(true);
    expect(roulette.toState().ownerId).toBe('dono-2');
    roulette.start('dono-2');
    roulette.clear();
    vi.advanceTimersByTime(SPIN_MS);
    expect(onResolve).not.toHaveBeenCalled();
    expect(roulette.toState()).toEqual({
      ownerId: null,
      entries: [],
      teams: [[], []],
      spin: null,
      last: null,
    });
  });
});
