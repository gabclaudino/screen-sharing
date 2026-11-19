import { describe, expect, it } from 'vitest';
import { validateJoin } from './join-validation';

describe('validateJoin', () => {
  it('aceita nome válido com senha preenchida', () => {
    expect(validateJoin('Ana', 'qualquer-senha')).toBeNull();
    expect(validateJoin('  Ana  ', 'x')).toBeNull();
  });

  it('a senha é sempre obrigatória', () => {
    expect(validateJoin('Ana', '')).toBe('Digite a senha de acesso.');
  });

  it('nome inválido é recusado antes da senha', () => {
    expect(validateJoin('', 'senha')).toMatch(/nome/i);
    expect(validateJoin('   ', 'senha')).toMatch(/nome/i);
    expect(validateJoin('a'.repeat(31), 'senha')).toMatch(/nome/i);
    expect(validateJoin('', '')).toMatch(/nome/i);
  });
});
