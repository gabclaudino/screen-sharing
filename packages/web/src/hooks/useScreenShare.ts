import { useCallback, useEffect, useRef, useState } from 'react';

export type ContentHint = 'detail' | 'motion';

export interface StartOptions {
  /** Pedir áudio do sistema/aba; tem de ser decidido antes da captura. */
  audio: boolean;
  contentHint: ContentHint;
}

export interface UseScreenShareOptions {
  onStart: (stream: MediaStream) => void;
  onStop: () => void;
}

export interface UseScreenShareResult {
  supported: boolean;
  stream: MediaStream | null;
  sharing: boolean;
  /** Pediu áudio mas o navegador/usuário não forneceu nenhuma faixa de áudio. */
  audioMissing: boolean;
  error: string | null;
  start: (options: StartOptions) => Promise<void>;
  stop: () => void;
  setContentHint: (hint: ContentHint) => void;
}

export const isCaptureSupported = (): boolean =>
  typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function';

export function describeCaptureError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
      return 'Permissão de captura negada ou cancelada.';
    case 'NotFoundError':
      return 'Nenhuma tela ou janela disponível para compartilhar.';
    case 'NotReadableError':
      return 'Não foi possível ler a tela (o sistema operacional pode estar bloqueando).';
    case 'AbortError':
      return 'A captura foi interrompida.';
    default:
      return 'Não foi possível iniciar o compartilhamento.';
  }
}

/** Captura de tela com getDisplayMedia; a distribuição aos peers fica nos callbacks. */
export function useScreenShare({ onStart, onStop }: UseScreenShareOptions): UseScreenShareResult {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [audioMissing, setAudioMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const callbacks = useRef({ onStart, onStop });
  useEffect(() => {
    callbacks.current = { onStart, onStop };
  }, [onStart, onStop]);

  const stop = useCallback(() => {
    const current = streamRef.current;
    if (!current) return;
    streamRef.current = null;
    // Tira o handler antes: parar as tracks dispara `ended` e chamaria stop() de novo.
    current.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    setStream(null);
    setAudioMissing(false);
    callbacks.current.onStop();
  }, []);

  const start = useCallback(
    async ({ audio, contentHint }: StartOptions) => {
      if (streamRef.current) return;
      setError(null);
      if (!isCaptureSupported()) {
        setError('Este navegador não suporta compartilhamento de tela.');
        return;
      }

      let captured: MediaStream;
      try {
        captured = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: { ideal: 30 } },
          audio,
        });
      } catch (captureError) {
        setError(describeCaptureError(captureError));
        return;
      }

      const [video] = captured.getVideoTracks();
      if (video) {
        // "detail" mantém texto/código nítido; "motion" prioriza fluidez (jogos/vídeo).
        video.contentHint = contentHint;
        // O botão nativo "Parar compartilhamento" do navegador encerra a track.
        video.onended = () => stop();
      }
      streamRef.current = captured;
      setStream(captured);
      setAudioMissing(audio && captured.getAudioTracks().length === 0);
      callbacks.current.onStart(captured);
    },
    [stop],
  );

  const setContentHint = useCallback((hint: ContentHint) => {
    const [video] = streamRef.current?.getVideoTracks() ?? [];
    if (video) video.contentHint = hint;
  }, []);

  // Fechar a sala (ou a aba) com a captura ativa precisa liberar a tela.
  useEffect(() => () => stop(), [stop]);

  return {
    supported: isCaptureSupported(),
    stream,
    sharing: stream !== null,
    audioMissing,
    error,
    start,
    stop,
    setContentHint,
  };
}
