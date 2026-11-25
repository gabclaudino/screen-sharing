// "Tec-tec" gerado pelo próprio navegador (Web Audio): sem arquivo de som.

export interface TickPlayer {
  /** Silencia ou devolve o som; os tecs continuam no tempo da roleta. */
  setAudible(audible: boolean): void;
  /** Cancela os tecs que ainda não tocaram. */
  stop(): void;
}

const TICK_HZ = 1500;
const TICK_SECONDS = 0.03;
const TICK_VOLUME = 0.2;

// Um só contexto para a página: o navegador limita quantos podem existir.
let shared: AudioContext | null = null;

function sharedContext(): AudioContext | null {
  if (shared) return shared;
  if (typeof AudioContext === 'undefined') return null;
  shared = new AudioContext();
  return shared;
}

/**
 * Agenda um tec em cada momento de `times` (ms a partir de agora). Se o navegador ainda estiver
 * segurando o áudio (autoplay), espera a liberação e pula o que já passou. Falhas de áudio nunca
 * atrapalham a roleta.
 */
export function playTicks(
  times: readonly number[],
  audible: boolean,
  getContext: () => AudioContext | null = sharedContext,
  now: () => number = () => Date.now(),
): TickPlayer {
  const silent: TickPlayer = { setAudible: () => undefined, stop: () => undefined };
  if (times.length === 0) return silent;
  let context: AudioContext | null;
  try {
    context = getContext();
  } catch (error) {
    console.warn('[som] áudio indisponível:', error);
    return silent;
  }
  if (!context) return silent;
  const ctx = context;

  const output = ctx.createGain();
  output.gain.value = audible ? 1 : 0;
  output.connect(ctx.destination);

  const startedAt = now();
  const nodes: OscillatorNode[] = [];
  let stopped = false;

  const schedule = () => {
    if (stopped) return;
    const elapsed = now() - startedAt;
    for (const time of times) {
      if (time < elapsed) continue;
      const at = ctx.currentTime + (time - elapsed) / 1000;
      const oscillator = ctx.createOscillator();
      const envelope = ctx.createGain();
      oscillator.type = 'triangle';
      oscillator.frequency.value = TICK_HZ;
      envelope.gain.setValueAtTime(TICK_VOLUME, at);
      envelope.gain.exponentialRampToValueAtTime(0.001, at + TICK_SECONDS);
      oscillator.connect(envelope);
      envelope.connect(output);
      oscillator.start(at);
      oscillator.stop(at + TICK_SECONDS);
      nodes.push(oscillator);
    }
  };

  if (ctx.state === 'running') schedule();
  else ctx.resume().then(schedule, (error: unknown) => console.warn('[som] bloqueado:', error));

  return {
    setAudible: (value) => {
      output.gain.value = value ? 1 : 0;
    },
    stop: () => {
      stopped = true;
      for (const node of nodes) node.stop();
      output.disconnect();
    },
  };
}
