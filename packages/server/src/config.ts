import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { parseNameAliases, type NameAliases } from './names';
import { parseReactionEmojis } from './reactions';

const PLACEHOLDER_PASSWORD = 'troque-isto';
const PLACEHOLDER_SECRET = 'string-aleatoria-longa';

// packages/server/src → raiz do repositório
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export type IceProviderName = 'cloudflare' | 'metered' | 'none';

export interface Config {
  /** Apelidos forçados pelo servidor (NAME_ALIASES): nome digitado → nome exibido. */
  nameAliases: NameAliases;
  /** Emojis dos botões de reação (REACTION_EMOJIS), na ordem de exibição. */
  reactionEmojis: readonly string[];
  nodeEnv: 'production' | 'development';
  host: string;
  port: number;
  allowedOrigin: string;
  accessPassword: string;
  sessionSecret: string;
  sessionTtlSec: number;
  maxPeersPerRoom: number;
  loginRateMax: number;
  loginRateWindowMs: number;
  wsMsgRatePerSec: number;
  staticDir: string;
  ice: {
    provider: IceProviderName;
    credentialTtlSec: number;
    cloudflare?: { keyId: string; apiToken: string };
    metered?: { appName: string; apiKey: string };
  };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const originSchema = z.string().refine(
  (value) => {
    try {
      const url = new URL(value);
      return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value;
    } catch {
      return false;
    }
  },
  { message: 'deve ser uma origem como https://share.seudominio.com (sem path nem barra final)' },
);

const positiveInt = (fallback: number, min = 1, max = 1_000_000) =>
  z.coerce.number().int().min(min).max(max).default(fallback);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['production', 'development']).default('production'),
    HOST: z.string().min(1).default('127.0.0.1'),
    PORT: positiveInt(3000, 0, 65535),
    ALLOWED_ORIGIN: originSchema,
    ACCESS_PASSWORD: z
      .string()
      .min(8, 'precisa ter pelo menos 8 caracteres')
      .refine((v) => v !== PLACEHOLDER_PASSWORD, 'troque o valor de exemplo'),
    SESSION_SECRET: z
      .string()
      .min(32, 'precisa ter pelo menos 32 caracteres')
      .refine((v) => v !== PLACEHOLDER_SECRET, 'troque o valor de exemplo'),
    SESSION_TTL_HOURS: positiveInt(12, 1, 24 * 30),
    MAX_PEERS_PER_ROOM: positiveInt(6, 2, 12),
    LOGIN_RATE_MAX: positiveInt(10),
    LOGIN_RATE_WINDOW_MIN: positiveInt(10, 1, 24 * 60),
    WS_MSG_RATE_PER_SEC: positiveInt(50),
    STATIC_DIR: z.string().min(1).default('packages/web/dist'),
    ICE_PROVIDER: z.enum(['cloudflare', 'metered', 'none']).default('none'),
    ICE_CREDENTIAL_TTL_SEC: positiveInt(86400, 60, 172800),
    CLOUDFLARE_TURN_KEY_ID: z.string().optional(),
    CLOUDFLARE_TURN_API_TOKEN: z.string().optional(),
    METERED_APP_NAME: z.string().optional(),
    METERED_API_KEY: z.string().optional(),
    NAME_ALIASES: z.string().optional(),
    REACTION_EMOJIS: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const requireKeys = (provider: string, keys: (keyof typeof env)[]) => {
      for (const key of keys) {
        if (!env[key]) {
          ctx.addIssue({
            code: 'custom',
            path: [key],
            message: `obrigatória quando ICE_PROVIDER=${provider}`,
          });
        }
      }
    };
    if (env.ICE_PROVIDER === 'cloudflare') {
      requireKeys('cloudflare', ['CLOUDFLARE_TURN_KEY_ID', 'CLOUDFLARE_TURN_API_TOKEN']);
    } else if (env.ICE_PROVIDER === 'metered') {
      requireKeys('metered', ['METERED_APP_NAME', 'METERED_API_KEY']);
    }
  });

/**
 * Valida as variáveis de ambiente e devolve a configuração tipada.
 * Falha rápido com `ConfigError` listando todos os problemas de uma vez.
 */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  // Variáveis vazias (ex.: `CLOUDFLARE_TURN_KEY_ID=`) equivalem a ausentes.
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value.trim() !== '') {
      cleaned[key] = value;
    }
  }

  const parsed = envSchema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(env)'}: ${issue.message}`,
    );
    throw new ConfigError(`Configuração inválida (confira o .env):\n${lines.join('\n')}`);
  }
  const e = parsed.data;

  let nameAliases: NameAliases;
  try {
    nameAliases = parseNameAliases(e.NAME_ALIASES);
  } catch (error) {
    throw new ConfigError(
      `Configuração inválida (confira o .env):
  - NAME_ALIASES: ${error instanceof Error ? error.message : 'inválido'}`,
    );
  }

  let reactionEmojis: string[];
  try {
    reactionEmojis = parseReactionEmojis(e.REACTION_EMOJIS);
  } catch (error) {
    throw new ConfigError(
      `Configuração inválida (confira o .env):
  - REACTION_EMOJIS: ${error instanceof Error ? error.message : 'inválido'}`,
    );
  }

  return {
    nameAliases,
    reactionEmojis,
    nodeEnv: e.NODE_ENV,
    host: e.HOST,
    port: e.PORT,
    allowedOrigin: e.ALLOWED_ORIGIN,
    accessPassword: e.ACCESS_PASSWORD,
    sessionSecret: e.SESSION_SECRET,
    sessionTtlSec: e.SESSION_TTL_HOURS * 3600,
    maxPeersPerRoom: e.MAX_PEERS_PER_ROOM,
    loginRateMax: e.LOGIN_RATE_MAX,
    loginRateWindowMs: e.LOGIN_RATE_WINDOW_MIN * 60_000,
    wsMsgRatePerSec: e.WS_MSG_RATE_PER_SEC,
    staticDir: path.isAbsolute(e.STATIC_DIR) ? e.STATIC_DIR : path.resolve(repoRoot, e.STATIC_DIR),
    ice: {
      provider: e.ICE_PROVIDER,
      credentialTtlSec: e.ICE_CREDENTIAL_TTL_SEC,
      ...(e.CLOUDFLARE_TURN_KEY_ID && e.CLOUDFLARE_TURN_API_TOKEN
        ? { cloudflare: { keyId: e.CLOUDFLARE_TURN_KEY_ID, apiToken: e.CLOUDFLARE_TURN_API_TOKEN } }
        : {}),
      ...(e.METERED_APP_NAME && e.METERED_API_KEY
        ? { metered: { appName: e.METERED_APP_NAME, apiKey: e.METERED_API_KEY } }
        : {}),
    },
  };
}
