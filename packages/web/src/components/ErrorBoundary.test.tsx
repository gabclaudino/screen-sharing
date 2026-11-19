import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from './ErrorBoundary';

describe('ErrorBoundary', () => {
  it('sem erro, renderiza os filhos', () => {
    const html = renderToStaticMarkup(
      <ErrorBoundary>
        <p>conteúdo normal</p>
      </ErrorBoundary>,
    );
    expect(html).toContain('conteúdo normal');
    expect(html).not.toContain('Algo deu errado');
  });

  it('um erro de renderização marca o estado como falho', () => {
    expect(ErrorBoundary.getDerivedStateFromError()).toEqual({ failed: true });
  });

  it('no estado falho mostra a tela de erro com o botão de recarregar, sem os filhos', () => {
    const boundary = new ErrorBoundary({ children: <p>não deve aparecer</p> });
    boundary.state = { failed: true };
    const html = renderToStaticMarkup(<>{boundary.render()}</>);
    expect(html).toContain('Algo deu errado');
    expect(html).toContain('Recarregar');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('não deve aparecer');
  });

  it('componentDidCatch registra o erro no console', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const boundary = new ErrorBoundary({ children: null });
    boundary.componentDidCatch(new Error('boom'), { componentStack: '\n at Room' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
