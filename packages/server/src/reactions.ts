import {
  DEFAULT_REACTION_EMOJIS,
  isValidReactionEmoji,
  MAX_REACTION_EMOJIS,
} from '@screenshare/shared';

/**
 * Lê `REACTION_EMOJIS`: emojis separados por espaço ou vírgula (ex.: `😂 🔥 💀`). Ausente ou vazio →
 * lista padrão. Repetidos são ignorados. Lança `Error` com uma mensagem em português.
 */
export function parseReactionEmojis(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [...DEFAULT_REACTION_EMOJIS];

  const emojis: string[] = [];
  for (const token of raw.split(/[\s,]+/u).filter((part) => part !== '')) {
    if (!isValidReactionEmoji(token)) {
      throw new Error(`"${token}" não é um emoji único (separe os emojis por espaço ou vírgula)`);
    }
    if (!emojis.includes(token)) emojis.push(token);
  }
  if (emojis.length > MAX_REACTION_EMOJIS) {
    throw new Error(`no máximo ${MAX_REACTION_EMOJIS} emojis (há ${emojis.length})`);
  }
  return emojis;
}
