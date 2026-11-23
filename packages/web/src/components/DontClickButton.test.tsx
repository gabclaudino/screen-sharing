import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DontClickButton } from './DontClickButton';

const html = renderToStaticMarkup(<DontClickButton />);

describe('DontClickButton', () => {
  it('mostra o botão "Não clique"', () => {
    expect(html).toContain('>Não clique</button>');
  });

  it('tem um diálogo com a imagem (com texto alternativo) e botão de fechar', () => {
    expect(html).toContain('<dialog');
    expect(html).toContain('src="/fotos/nao-clique.png"');
    expect(html).toContain('alt="Um homem comendo um cachorro-quente');
    expect(html).toContain('>Fechar</button>');
  });
});
