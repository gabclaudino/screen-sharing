import { DEFAULT_REACTION_EMOJIS } from '@screenshare/shared';
import { describe, expect, it } from 'vitest';
import { parseReactionEmojis } from './reactions';

describe('parseReactionEmojis', () => {
  it('ausente ou vazio → lista padrão', () => {
    expect(parseReactionEmojis(undefined)).toEqual([...DEFAULT_REACTION_EMOJIS]);
    expect(parseReactionEmojis('   ')).toEqual([...DEFAULT_REACTION_EMOJIS]);
  });

  it('aceita espaços, vírgulas e mistura, mantendo a ordem', () => {
    expect(parseReactionEmojis('😂 🔥,💀 , 👏')).toEqual(['😂', '🔥', '💀', '👏']);
  });

  it('aceita emojis compostos (❤️, bandeira, família) como um só', () => {
    expect(parseReactionEmojis('❤️ 🇧🇷 👨‍👩‍👧 👍🏽')).toEqual(['❤️', '🇧🇷', '👨‍👩‍👧', '👍🏽']);
  });

  it('ignora repetidos', () => {
    expect(parseReactionEmojis('🔥 🔥 😂')).toEqual(['🔥', '😂']);
  });

  it('rejeita texto, emojis grudados e lista grande demais', () => {
    expect(() => parseReactionEmojis('🔥 oi')).toThrow(/"oi" não é um emoji único/);
    expect(() => parseReactionEmojis('🔥😂')).toThrow(/não é um emoji único/);
    expect(() => parseReactionEmojis('1 2')).toThrow(/não é um emoji único/);
    expect(() => parseReactionEmojis('😀 😁 😂 🤣 😃 😄 😅 😆 😉 😊 😋 😎 😍')).toThrow(
      /no máximo 12/,
    );
  });
});
