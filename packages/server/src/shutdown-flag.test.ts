import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchShutdownFlag } from './shutdown-flag';

describe('watchShutdownFlag', () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    vi.useFakeTimers();
    dir = mkdtempSync(path.join(tmpdir(), 'screenshare-flag-'));
    file = path.join(dir, 'desligar.flag');
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it('sem o arquivo não faz nada', () => {
    const onShutdown = vi.fn();
    const stop = watchShutdownFlag(file, onShutdown, 100);
    vi.advanceTimersByTime(1000);
    expect(onShutdown).not.toHaveBeenCalled();
    stop();
  });

  it('quando o arquivo aparece, apaga e desliga uma única vez', () => {
    const onShutdown = vi.fn();
    const stop = watchShutdownFlag(file, onShutdown, 100);
    writeFileSync(file, '');
    vi.advanceTimersByTime(100);
    expect(onShutdown).toHaveBeenCalledTimes(1);
    expect(existsSync(file)).toBe(false);

    writeFileSync(file, ''); // um segundo pedido não repete: já está desligando
    vi.advanceTimersByTime(1000);
    expect(onShutdown).toHaveBeenCalledTimes(1);
    stop();
  });

  it('um arquivo esquecido de antes é apagado ao começar e não desliga o servidor', () => {
    writeFileSync(file, '');
    const onShutdown = vi.fn();
    const stop = watchShutdownFlag(file, onShutdown, 100);
    expect(existsSync(file)).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(onShutdown).not.toHaveBeenCalled();
    stop();
  });

  it('depois de parada, a vigilância ignora o arquivo', () => {
    const onShutdown = vi.fn();
    const stop = watchShutdownFlag(file, onShutdown, 100);
    stop();
    writeFileSync(file, '');
    vi.advanceTimersByTime(1000);
    expect(onShutdown).not.toHaveBeenCalled();
  });
});
