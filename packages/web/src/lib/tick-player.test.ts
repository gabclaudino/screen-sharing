import { describe, expect, it, vi } from 'vitest';
import { playTicks } from './tick-player';

function fakeContext(state: 'running' | 'suspended' = 'running') {
  const starts: number[] = [];
  const stop = vi.fn();
  const gains: { value: number }[] = [];
  let release: () => void = () => undefined;
  const context = {
    state,
    currentTime: 10,
    destination: {},
    resume: () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    createGain: () => {
      const gain = { value: 1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() };
      gains.push(gain);
      return { gain, connect: vi.fn(), disconnect: vi.fn() };
    },
    createOscillator: () => ({
      type: '',
      frequency: { value: 0 },
      connect: vi.fn(),
      start: (at: number) => starts.push(at),
      stop,
    }),
  } as unknown as AudioContext;
  return { context, starts, stop, gains, release: () => release() };
}

describe('playTicks', () => {
  it('agenda um som em cada momento e silencia/devolve pela saída', () => {
    const fake = fakeContext();
    const player = playTicks(
      [100, 600],
      true,
      () => fake.context,
      () => 0,
    );
    expect(fake.starts).toEqual([10.1, 10.6]);
    expect(fake.gains[0]?.value).toBe(1);
    player.setAudible(false);
    expect(fake.gains[0]?.value).toBe(0);
  });

  it('stop cancela os que faltam', () => {
    const fake = fakeContext();
    playTicks([100], false, () => fake.context).stop();
    // Um stop do próprio agendamento e outro do cancelamento.
    expect(fake.stop).toHaveBeenCalledTimes(2);
  });

  it('áudio retido pelo navegador: toca só o que ainda não passou quando liberar', async () => {
    const fake = fakeContext('suspended');
    let clock = 0;
    playTicks(
      [100, 600],
      true,
      () => fake.context,
      () => clock,
    );
    expect(fake.starts).toEqual([]);
    clock = 400;
    fake.release();
    await Promise.resolve();
    expect(fake.starts).toEqual([10.2]);
  });

  it('sem Web Audio não faz nada', () => {
    expect(() => playTicks([100], true, () => null).stop()).not.toThrow();
  });
});
