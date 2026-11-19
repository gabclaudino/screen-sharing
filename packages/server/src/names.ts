import { isValidName } from '@screenshare/shared';

/**
 * Chave de comparação de um nome: sem maiúsculas, acentos, espaços nem separadores (`_`, `-`, `.`).
 * Assim "Stan God", "STAN_GOD" e "stangod" viram a mesma chave. É só para comparar; o nome
 * exibido nunca é alterado por isso.
 */
export function normalizeNameKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[\s._-]+/gu, '');
}

/** Apelidos forçados pelo servidor: chave normalizada → nome exibido. */
export type NameAliases = ReadonlyMap<string, string>;

/**
 * Nome que vai aparecer na sala: o apelido, se a pessoa digitou um dos nomes configurados (igualdade
 * exata depois de normalizar, então "stanley" não vira apelido de "stan"), ou o próprio nome.
 */
export function resolveDisplayName(name: string, aliases: NameAliases): string {
  const trimmed = name.trim();
  return aliases.get(normalizeNameKey(trimmed)) ?? trimmed;
}

/**
 * Lê `NAME_ALIASES`: um JSON `{"nome digitado": "nome exibido", ...}`. Lança `Error` com uma
 * mensagem em português dizendo o que está errado.
 */
export function parseNameAliases(raw: string | undefined): Map<string, string> {
  const aliases = new Map<string, string>();
  if (raw === undefined || raw.trim() === '') return aliases;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new Error('deve ser um JSON válido, como {"fulano":"Apelido"}');
  }
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('deve ser um objeto JSON, como {"fulano":"Apelido"}');
  }

  for (const [typed, shown] of Object.entries(json)) {
    const key = normalizeNameKey(typed);
    if (key === '') throw new Error(`o nome "${typed}" não tem nenhuma letra ou número`);
    if (typeof shown !== 'string' || !isValidName(shown)) {
      throw new Error(`o apelido de "${typed}" é inválido (1 a 30 caracteres, sem controle)`);
    }
    const nome = shown.trim();
    const existente = aliases.get(key);
    if (existente !== undefined && existente !== nome) {
      throw new Error(`"${typed}" aparece mais de uma vez com apelidos diferentes`);
    }
    aliases.set(key, nome);
  }
  return aliases;
}
