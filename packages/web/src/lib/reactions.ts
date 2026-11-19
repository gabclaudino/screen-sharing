import type { ReactionEmoji } from '@screenshare/shared';

/** Um emoji subindo na tela. `left` é a posição horizontal em % da largura. */
export interface Floater {
  id: number;
  emoji: ReactionEmoji;
  /** Quem reagiu ("você" para as próprias reações). */
  label: string;
  left: number;
}

/** Máximo de emojis na tela ao mesmo tempo; os mais antigos saem primeiro. */
export const MAX_FLOATERS = 30;

/** A animação dura 3 s; passado esse tempo o emoji é removido mesmo sem o evento de fim. */
export const FLOATER_LIFETIME_MS = 4000;

/** Intervalo mínimo entre duas reações enviadas pela mesma pessoa. */
export const REACTION_COOLDOWN_MS = 200;

export function pushFloater(list: readonly Floater[], floater: Floater): Floater[] {
  const next = [...list, floater];
  return next.length > MAX_FLOATERS ? next.slice(next.length - MAX_FLOATERS) : next;
}

export function removeFloater(list: readonly Floater[], id: number): Floater[] {
  return list.filter((floater) => floater.id !== id);
}

/** Posição horizontal aleatória, longe das bordas (10% a 90%). `random` vem de fora para testar. */
export function randomLeft(random: () => number = Math.random): number {
  return 10 + Math.round(random() * 80);
}
