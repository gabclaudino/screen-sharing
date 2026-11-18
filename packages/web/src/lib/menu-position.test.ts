import { describe, expect, it } from 'vitest';
import { clampMenuPosition } from './menu-position';

const menu = { width: 200, height: 100 };
const container = { width: 800, height: 600 };

describe('clampMenuPosition', () => {
  it('mantém o ponto do clique quando o menu cabe', () => {
    expect(clampMenuPosition({ x: 100, y: 150 }, menu, container)).toEqual({ left: 100, top: 150 });
  });

  it('empurra para dentro quando o clique é perto da borda direita/inferior', () => {
    expect(clampMenuPosition({ x: 790, y: 590 }, menu, container)).toEqual({
      left: 596,
      top: 496,
    });
  });

  it('nunca passa da margem esquerda/superior', () => {
    expect(clampMenuPosition({ x: -20, y: -5 }, menu, container)).toEqual({ left: 4, top: 4 });
  });

  it('em contêiner menor que o menu, fica na margem', () => {
    expect(clampMenuPosition({ x: 50, y: 50 }, menu, { width: 120, height: 60 })).toEqual({
      left: 4,
      top: 4,
    });
  });
});
