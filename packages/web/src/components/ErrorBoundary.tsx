import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
}

/**
 * Última barreira: um erro de renderização em qualquer componente deixaria a página em branco.
 * Mostra uma tela simples com a opção de recarregar (isso solta captura, WS e conexões, pois o
 * cleanup dos efeitos roda quando a árvore é desmontada).
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[app] erro de renderização:', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="join">
        <div className="card join-form" role="alert">
          <h1>Algo deu errado</h1>
          <p className="muted">
            O app encontrou um erro inesperado. Recarregar a página costuma resolver; se o problema
            continuar, avise quem administra o servidor.
          </p>
          <button type="button" className="primary" onClick={() => window.location.reload()}>
            Recarregar
          </button>
        </div>
      </main>
    );
  }
}
