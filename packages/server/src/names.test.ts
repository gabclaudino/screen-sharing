import { describe, expect, it } from 'vitest';
import { normalizeNameKey, parseNameAliases, resolveDisplayName } from './names';

describe('normalizeNameKey', () => {
  it('ignora maiúsculas, espaços e separadores', () => {
    for (const nome of [
      'stangod',
      'StanGod',
      'STANGOD',
      'Stan God',
      'stan god',
      'STAN_GOD',
      'stan-god',
      'Stan.God',
      '  stan  god  ',
    ]) {
      expect(normalizeNameKey(nome)).toBe('stangod');
    }
  });

  it('ignora acentos', () => {
    expect(normalizeNameKey('Stán')).toBe('stan');
    expect(normalizeNameKey('JOSÉ')).toBe('jose');
  });
});

describe('resolveDisplayName', () => {
  const aliases = parseNameAliases('{"stan":"Apelido X","stangod":"Apelido X"}');

  it('troca os dois nomes configurados, em qualquer grafia', () => {
    for (const nome of [
      'stan',
      'Stan',
      'STAN',
      'stangod',
      'StanGod',
      'STANGOD',
      'Stan God',
      'stan_god',
      ' stan ',
    ]) {
      expect(resolveDisplayName(nome, aliases)).toBe('Apelido X');
    }
  });

  it('só vale para igualdade exata: nomes parecidos ficam como estão', () => {
    expect(resolveDisplayName('stanley', aliases)).toBe('stanley');
    expect(resolveDisplayName('estan', aliases)).toBe('estan');
    expect(resolveDisplayName('stan2', aliases)).toBe('stan2');
    expect(resolveDisplayName('Ana', aliases)).toBe('Ana');
  });

  it('sem apelidos configurados devolve o nome sem espaços nas pontas', () => {
    expect(resolveDisplayName('  Ana  ', new Map())).toBe('Ana');
  });
});

describe('parseNameAliases', () => {
  it('vazio ou ausente → sem apelidos', () => {
    expect(parseNameAliases(undefined).size).toBe(0);
    expect(parseNameAliases('').size).toBe(0);
    expect(parseNameAliases('   ').size).toBe(0);
  });

  it('normaliza as chaves e guarda o apelido', () => {
    const aliases = parseNameAliases('{"Stan God":"Fulano","  ANA_maria ":"Ana M"}');
    expect(aliases.get('stangod')).toBe('Fulano');
    expect(aliases.get('anamaria')).toBe('Ana M');
  });

  it('chaves que viram a mesma com o mesmo apelido são aceitas; com apelidos diferentes, não', () => {
    expect(parseNameAliases('{"stan":"X","Stan":"X"}').size).toBe(1);
    expect(() => parseNameAliases('{"stan":"X","STAN":"Y"}')).toThrow(/mais de uma vez/);
  });

  it('rejeita JSON inválido, formato errado, chave vazia e apelido inválido', () => {
    expect(() => parseNameAliases('{nope')).toThrow(/JSON válido/);
    expect(() => parseNameAliases('["a"]')).toThrow(/objeto JSON/);
    expect(() => parseNameAliases('"texto"')).toThrow(/objeto JSON/);
    expect(() => parseNameAliases('{" _ ":"X"}')).toThrow(/nenhuma letra/);
    expect(() => parseNameAliases('{"stan":""}')).toThrow(/inválido/);
    expect(() => parseNameAliases('{"stan":123}')).toThrow(/inválido/);
    expect(() => parseNameAliases(`{"stan":"${'a'.repeat(31)}"}`)).toThrow(/inválido/);
    expect(() => parseNameAliases('{"stan":"\\u202eX"}')).toThrow(/inválido/);
  });
});
