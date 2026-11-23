import { describe, expect, it, vi } from 'vitest';
import { RESUME_WINDOW_MS, resumeAfterFullscreen, type ResumableVideo } from './fullscreen-resume';

function makeVideo(srcObject: unknown = {}) {
  const listeners = new Map<string, Set<() => void>>();
  const play = vi.fn(() => Promise.resolve());
  const video: ResumableVideo & { srcObject: unknown; emit(type: string): void; count(): number } =
    {
      srcObject,
      play,
      addEventListener: (type, listener) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)?.add(listener);
      },
      removeEventListener: (type, listener) => void listeners.get(type)?.delete(listener),
      emit: (type) => listeners.get(type)?.forEach((listener) => listener()),
      count: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
    };
  return { video, play };
}

describe('resumeAfterFullscreen', () => {
  it('ao sair da tela cheia retoma na hora', () => {
    const { video, play } = makeVideo();
    resumeAfterFullscreen(video, () => 0);
    video.emit('webkitendfullscreen');
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('se o iOS pausar logo depois de sair, retoma de novo', () => {
    let clock = 1000;
    const { video, play } = makeVideo();
    resumeAfterFullscreen(video, () => clock);
    video.emit('webkitendfullscreen');
    clock += 300;
    video.emit('pause');
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('uma pausa fora da janela (ou sem ter saído da tela cheia) não é mexida', () => {
    let clock = 1000;
    const { video, play } = makeVideo();
    resumeAfterFullscreen(video, () => clock);
    video.emit('pause'); // nunca entrou/saiu da tela cheia
    expect(play).not.toHaveBeenCalled();

    video.emit('webkitendfullscreen');
    expect(play).toHaveBeenCalledTimes(1);
    clock += RESUME_WINDOW_MS; // janela acabou
    video.emit('pause');
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('sem transmissão no vídeo não tenta tocar', () => {
    const { video, play } = makeVideo(null);
    resumeAfterFullscreen(video, () => 0);
    video.emit('webkitendfullscreen');
    expect(play).not.toHaveBeenCalled();
  });

  it('play() recusado vai para onError, sem estourar', async () => {
    const { video, play } = makeVideo();
    play.mockReturnValueOnce(Promise.reject(new Error('bloqueado')));
    const onError = vi.fn();
    resumeAfterFullscreen(video, () => 0, onError);
    video.emit('webkitendfullscreen');
    await Promise.resolve();
    await Promise.resolve();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('a função devolvida remove os ouvintes', () => {
    const { video, play } = makeVideo();
    const stop = resumeAfterFullscreen(video, () => 0);
    expect(video.count()).toBe(2);
    stop();
    expect(video.count()).toBe(0);
    video.emit('webkitendfullscreen');
    expect(play).not.toHaveBeenCalled();
  });
});
