import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AudioGuideDialog } from './AudioGuideDialog';

const html = renderToStaticMarkup(<AudioGuideDialog open={false} onClose={() => undefined} />);

describe('AudioGuideDialog', () => {
  it('avisa que mandar o Discord "para o fone" só adianta se o padrão for outro dispositivo', () => {
    expect(html).toContain('só adianta se o dispositivo padrão');
    expect(html).toContain('os dois saem pelo mesmo lugar');
    expect(html).toContain('role="note"');
  });

  it('ajuda a descobrir o caso: o ícone de som mostra o dispositivo padrão', () => {
    expect(html).toContain('Qual é o seu caso?');
    expect(html).toContain('ícone de som');
  });

  it('Caso A: padrão virtual (FxSound), sem instalar nada, Discord direto no fone', () => {
    expect(html).toContain('Caso A');
    expect(html).toContain('FxSound');
    expect(html).toContain('Não precisa instalar nada');
    expect(html).toContain('Mande o Discord direto para o fone');
  });

  it('Caso B: padrão é o fone, então é preciso o VB-CABLE como dispositivo padrão', () => {
    expect(html).toContain('Caso B');
    expect(html).toContain('VB-CABLE');
    expect(html).toContain('CABLE Input');
    expect(html).toContain('Ouvir este dispositivo');
  });

  it('o FxSound não é mandado instalar o VB-CABLE (ele impede trocar o padrão)', () => {
    expect(html).toContain('quem usa FxSound segue o Caso A');
  });

  it('é um diálogo acessível com título e botão de fechar', () => {
    expect(html).toContain('aria-labelledby="guide-title"');
    expect(html).toContain('Entendi');
  });
});
