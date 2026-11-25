import type { RouletteState } from '@screenshare/shared';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RoulettePanel } from './RoulettePanel';

const ME = '3f2b8c1e-5a47-4d6b-9c1a-0e7d2f4b6a10';
const OTHER = '9a1d7e52-83c4-4f0b-b6a2-1c5e8d3f7a21';

const state = (patch: Partial<RouletteState> = {}): RouletteState => ({
  ownerId: null,
  entries: [],
  teams: [[], []],
  spin: null,
  last: null,
  ...patch,
});

const render = (roulette: RouletteState) =>
  renderToStaticMarkup(
    <RoulettePanel
      roulette={roulette}
      selfId={ME}
      ownerName="Bia"
      disabled={false}
      onCommand={() => undefined}
    />,
  );

describe('RoulettePanel', () => {
  it('livre: oferece assumir o controle', () => {
    expect(render(state())).toContain('>Usar a roleta</button>');
  });

  it('quem controla tem o campo de nomes e o botão Girar', () => {
    const html = render(state({ ownerId: ME, entries: ['Ana'] }));
    expect(html).toContain('aria-label="Nome do jogador"');
    expect(html).toContain('>Girar</button>');
    expect(html).toContain('aria-label="Remover Ana"');
  });

  it('os outros só assistem', () => {
    const html = render(state({ ownerId: OTHER, entries: ['Ana'] }));
    expect(html).toContain('Bia está usando a roleta');
    expect(html).not.toContain('>Girar</button>');
    expect(html).not.toContain('Remover Ana');
  });

  it('mostra os times e quem acabou de ser sorteado; durante o giro, o time de destino', () => {
    const done = render(state({ teams: [['Ana'], []], last: { name: 'Ana', team: 0 } }));
    expect(done).toContain('<strong>Ana</strong> entrou no TIME 1');
    const spinning = render(
      state({ entries: ['Caio'], teams: [['Ana'], []], spin: { seq: 2, index: 0, ms: 5000 } }),
    );
    expect(spinning).toContain('Sorteando… vai para o TIME 2');
  });
});
