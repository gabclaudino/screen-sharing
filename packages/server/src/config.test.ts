import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

const valid = {
  ALLOWED_ORIGIN: 'https://share.example.com',
  ACCESS_PASSWORD: 'uma-senha-boa',
  SESSION_SECRET: 's'.repeat(40),
};

const messageOf = (env: Record<string, string | undefined>): string => {
  try {
    loadConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfigError);
    return (error as Error).message;
  }
  throw new Error('loadConfig não falhou');
};

describe('loadConfig', () => {
  it('aplica defaults com o mínimo de variáveis', () => {
    const config = loadConfig(valid);
    expect(config).toMatchObject({
      nodeEnv: 'production',
      host: '127.0.0.1',
      port: 3000,
      maxPeersPerRoom: 6,
      sessionTtlSec: 12 * 3600,
      loginRateMax: 10,
      loginRateWindowMs: 10 * 60_000,
      wsMsgRatePerSec: 400,
      ice: { provider: 'none', credentialTtlSec: 86400 },
    });
  });

  it('a pasta de fotos padrão é public/fotos', () => {
    const config = loadConfig({
      ALLOWED_ORIGIN: 'http://localhost:3000',
      ACCESS_PASSWORD: 'senha-de-teste-123',
      SESSION_SECRET: 's'.repeat(40),
    });
    expect(config.photosDir.endsWith(path.join('packages', 'web', 'public', 'fotos'))).toBe(true);
  });

  it('resolve STATIC_DIR relativo a partir da raiz do repositório', () => {
    const config = loadConfig(valid);
    expect(path.isAbsolute(config.staticDir)).toBe(true);
    expect(config.staticDir.endsWith(path.join('packages', 'web', 'dist'))).toBe(true);
  });

  it('trata variável vazia como ausente', () => {
    const config = loadConfig({ ...valid, PORT: '', CLOUDFLARE_TURN_KEY_ID: '' });
    expect(config.port).toBe(3000);
  });

  it('rejeita os valores de exemplo de senha e segredo', () => {
    expect(messageOf({ ...valid, ACCESS_PASSWORD: 'troque-isto' })).toContain('ACCESS_PASSWORD');
    expect(messageOf({ ...valid, SESSION_SECRET: 'string-aleatoria-longa' })).toContain(
      'SESSION_SECRET',
    );
  });

  it('exige tamanhos mínimos de senha e segredo', () => {
    expect(messageOf({ ...valid, ACCESS_PASSWORD: 'curta' })).toContain('ACCESS_PASSWORD');
    expect(messageOf({ ...valid, SESSION_SECRET: 'curto' })).toContain('SESSION_SECRET');
  });

  it('exige ALLOWED_ORIGIN válida, sem path nem barra final', () => {
    expect(messageOf({ ...valid, ALLOWED_ORIGIN: undefined })).toContain('ALLOWED_ORIGIN');
    expect(messageOf({ ...valid, ALLOWED_ORIGIN: 'https://share.example.com/' })).toContain(
      'ALLOWED_ORIGIN',
    );
    expect(messageOf({ ...valid, ALLOWED_ORIGIN: 'share.example.com' })).toContain(
      'ALLOWED_ORIGIN',
    );
    expect(messageOf({ ...valid, ALLOWED_ORIGIN: 'ftp://share.example.com' })).toContain(
      'ALLOWED_ORIGIN',
    );
  });

  it('exige as chaves do provedor ICE escolhido', () => {
    const cf = messageOf({ ...valid, ICE_PROVIDER: 'cloudflare' });
    expect(cf).toContain('CLOUDFLARE_TURN_KEY_ID');
    expect(cf).toContain('CLOUDFLARE_TURN_API_TOKEN');
    const metered = messageOf({ ...valid, ICE_PROVIDER: 'metered' });
    expect(metered).toContain('METERED_APP_NAME');
    expect(metered).toContain('METERED_API_KEY');
  });

  it('aceita provedor completo e ignora chaves de outros provedores', () => {
    const config = loadConfig({
      ...valid,
      ICE_PROVIDER: 'cloudflare',
      CLOUDFLARE_TURN_KEY_ID: 'kid',
      CLOUDFLARE_TURN_API_TOKEN: 'tok',
    });
    expect(config.ice.cloudflare).toEqual({ keyId: 'kid', apiToken: 'tok' });
    expect(loadConfig({ ...valid, ICE_PROVIDER: 'none' }).ice.cloudflare).toBeUndefined();
  });

  it('NAME_ALIASES: sem a variável não há apelidos; com ela, as chaves são normalizadas', () => {
    expect(loadConfig(valid).nameAliases.size).toBe(0);
    const config = loadConfig({ ...valid, NAME_ALIASES: '{"Stan God":"Fulano","STAN":"Fulano"}' });
    expect(config.nameAliases.get('stangod')).toBe('Fulano');
    expect(config.nameAliases.get('stan')).toBe('Fulano');
  });

  it('REACTION_EMOJIS: padrão sem a variável; com ela, a lista do dono na ordem dada', () => {
    expect(loadConfig(valid).reactionEmojis).toHaveLength(6);
    expect(loadConfig({ ...valid, REACTION_EMOJIS: '🐸, 🍕 🔥' }).reactionEmojis).toEqual([
      '🐸',
      '🍕',
      '🔥',
    ]);
  });

  it('REACTION_EMOJIS inválida falha na subida, dizendo a variável e o motivo', () => {
    expect(messageOf({ ...valid, REACTION_EMOJIS: '🔥 oi' })).toMatch(
      /REACTION_EMOJIS.*"oi" não é um emoji/s,
    );
  });

  it('NAME_ALIASES inválida falha na subida, dizendo a variável e o motivo', () => {
    expect(messageOf({ ...valid, NAME_ALIASES: '{nope' })).toMatch(/NAME_ALIASES.*JSON válido/s);
    expect(messageOf({ ...valid, NAME_ALIASES: '{"a":""}' })).toMatch(/NAME_ALIASES.*inválido/s);
  });

  it('lista todos os problemas dos campos básicos de uma vez', () => {
    const message = messageOf({ PORT: '70000' });
    for (const key of ['PORT', 'ALLOWED_ORIGIN', 'ACCESS_PASSWORD', 'SESSION_SECRET']) {
      expect(message).toContain(key);
    }
  });

  it('valida limites numéricos', () => {
    expect(messageOf({ ...valid, PORT: '70000' })).toContain('PORT');
    expect(messageOf({ ...valid, MAX_PEERS_PER_ROOM: '1' })).toContain('MAX_PEERS_PER_ROOM');
    expect(messageOf({ ...valid, PORT: 'abc' })).toContain('PORT');
  });
});
