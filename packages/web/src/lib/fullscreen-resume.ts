/** O que precisamos de um <video>; permite testar com um falso, sem navegador. */
export interface ResumableVideo {
  readonly srcObject: unknown;
  play(): Promise<void>;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

/** Tempo, depois de sair da tela cheia, em que uma pausa ainda é a do iOS (e não do usuário). */
export const RESUME_WINDOW_MS = 1500;

/**
 * No iPhone/iPad a tela cheia é o player nativo do iOS (`webkitEnterFullscreen`), e ao sair dele o
 * iOS **pausa** o vídeo, o que numa transmissão ao vivo congela a imagem. Aqui: ao sair da tela
 * cheia (`webkitendfullscreen`) retoma na hora e, se o iOS pausar um instante depois, retoma de novo
 * (por `RESUME_WINDOW_MS`). Fora dessa janela uma pausa não é mexida.
 * Devolve a função que remove os ouvintes.
 */
export function resumeAfterFullscreen(
  video: ResumableVideo,
  now: () => number = () => Date.now(),
  onError: (error: unknown) => void = () => undefined,
): () => void {
  let resumeUntil = 0;
  const resume = () => {
    // Sem transmissão no vídeo não há o que retomar.
    if (video.srcObject) video.play().catch(onError);
  };
  const onEnd = () => {
    resumeUntil = now() + RESUME_WINDOW_MS;
    resume();
  };
  const onPause = () => {
    if (now() < resumeUntil) resume();
  };

  video.addEventListener('webkitendfullscreen', onEnd);
  video.addEventListener('pause', onPause);
  return () => {
    video.removeEventListener('webkitendfullscreen', onEnd);
    video.removeEventListener('pause', onPause);
  };
}
